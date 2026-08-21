<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/features.php';

assert_same_origin_for_write();
$db = community_db();
ensure_community_features($db);
$action = (string)($_GET['action'] ?? 'health');

function create_forum_thread(PDO $db, array $user, string $title, string $body, string $visibility): array {
    $db->beginTransaction();
    try {
        $stmt = $db->prepare('INSERT INTO forum_threads (user_id, title, visibility) VALUES (?, ?, ?)');
        $stmt->execute([(int)$user['id'], $title, $visibility]);
        $threadId = (int)$db->lastInsertId();
        $stmt = $db->prepare('INSERT INTO forum_posts (thread_id, user_id, body) VALUES (?, ?, ?)');
        $stmt->execute([$threadId, (int)$user['id'], $body]);
        $postId = (int)$db->lastInsertId();
        $attachment = attachment_from_request($db, $postId);
        $db->commit();
        return ['threadId' => $threadId, 'postId' => $postId, 'attachment' => $attachment];
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function admin_forum_thread(PDO $db, int $threadId): ?array {
    $stmt = $db->prepare(<<<'SQL'
SELECT t.id, t.title, t.visibility, t.is_locked, t.created_at, t.updated_at,
       u.username, u.display_name
FROM forum_threads t
JOIN users u ON u.id = t.user_id
WHERE t.id = ?
SQL);
    $stmt->execute([$threadId]);
    $thread = $stmt->fetch();
    if (!$thread) return null;

    $stmt = $db->prepare(<<<'SQL'
SELECT p.id, p.body, p.created_at, p.edited_at,
       u.username, u.display_name
FROM forum_posts p
JOIN users u ON u.id = p.user_id
WHERE p.thread_id = ?
ORDER BY p.created_at ASC, p.id ASC
SQL);
    $stmt->execute([$threadId]);
    $postRows = $stmt->fetchAll();
    $attachmentMap = attachments_for_posts($db, array_column($postRows, 'id'));
    $posts = array_map(static function(array $row) use ($attachmentMap): array {
        $postId = (int)$row['id'];
        return [
            'id' => $postId,
            'body' => (string)$row['body'],
            'createdAt' => (string)$row['created_at'],
            'editedAt' => $row['edited_at'] === null ? null : (string)$row['edited_at'],
            'attachments' => $attachmentMap[$postId] ?? [],
            'author' => ['username' => (string)$row['username'], 'displayName' => (string)$row['display_name']],
        ];
    }, $postRows);

    return [
        'id' => (int)$thread['id'],
        'title' => (string)$thread['title'],
        'visibility' => (string)$thread['visibility'],
        'locked' => (bool)$thread['is_locked'],
        'createdAt' => (string)$thread['created_at'],
        'updatedAt' => (string)$thread['updated_at'],
        'author' => ['username' => (string)$thread['username'], 'displayName' => (string)$thread['display_name']],
        'posts' => $posts,
    ];
}

function remove_stored_attachments(array $storedNames): void {
    $root = community_upload_dir();
    foreach ($storedNames as $storedName) {
        $name = basename((string)$storedName);
        if ($name === '') continue;
        $path = $root . '/' . $name;
        if (is_file($path)) @unlink($path);
    }
}

try {
    switch ($action) {
        case 'health':
            respond(['ok' => true, 'service' => 'birdesengor-community', 'storage' => 'sqlite', 'smtpConfigured' => smtp_configured(), 'features' => ['emailVerification', 'forum', 'attachments', 'specialAccess', 'forumAdmin']]);

        case 'me':
            require_method('GET');
            $user = current_user($db);
            respond(['ok' => true, 'authenticated' => (bool)$user, 'user' => $user ? community_public_user($db, $user) : null]);

        case 'register':
            require_method('POST');
            $input = request_data();
            $username = normalize_username((string)($input['username'] ?? ''));
            $displayName = normalize_display_name((string)($input['displayName'] ?? ''), $username);
            $email = normalize_email((string)($input['email'] ?? ''));
            $password = normalize_password((string)($input['password'] ?? ''));
            $hash = password_hash($password, PASSWORD_DEFAULT);
            if (!is_string($hash)) fail('Parola hazırlanamadı.', 500, 'password_error');

            $db->beginTransaction();
            try {
                $stmt = $db->prepare('INSERT INTO users (username, display_name, email, password_hash) VALUES (?, ?, ?, ?)');
                $stmt->execute([$username, $displayName, $email, $hash]);
                $id = (int)$db->lastInsertId();
                $token = issue_verification($db, $id);
                ensure_initial_admin($db);
                $db->commit();
            } catch (PDOException $error) {
                if ($db->inTransaction()) $db->rollBack();
                $message = strtolower($error->getMessage());
                if (str_contains($message, 'unique')) {
                    if (str_contains($message, 'email')) fail('Bu e-posta adresi zaten kullanılıyor.', 409, 'email_taken');
                    fail('Bu kullanıcı adı zaten kullanılıyor.', 409, 'username_taken');
                }
                throw $error;
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }

            if (!send_verification_email($email, $displayName, $token)) {
                fail('Hesap oluşturuldu ancak doğrulama e-postası gönderilemedi. Giriş bölümünden doğrulama e-postasını yeniden gönderebilirsin.', 503, 'email_delivery_failed');
            }
            respond(['ok' => true, 'registered' => true, 'verificationRequired' => true, 'email' => $email], 201);

        case 'verify':
            require_method('GET');
            $token = trim((string)($_GET['token'] ?? ''));
            if (!preg_match('/^[a-f0-9]{64}$/', $token)) verification_redirect('verification-error');
            $hash = hash('sha256', $token);
            $stmt = $db->prepare(<<<'SQL'
SELECT u.id
FROM email_verifications ev
JOIN users u ON u.id = ev.user_id
WHERE ev.token_hash = ? AND ev.expires_at > CURRENT_TIMESTAMP
LIMIT 1
SQL);
            $stmt->execute([$hash]);
            $userId = $stmt->fetchColumn();
            if ($userId === false) verification_redirect('verification-error');
            $db->beginTransaction();
            try {
                $db->prepare('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?')->execute([(int)$userId]);
                $db->prepare('DELETE FROM email_verifications WHERE user_id = ?')->execute([(int)$userId]);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
            verification_redirect('verified');

        case 'resend_verification':
            require_method('POST');
            $input = request_data();
            $identifier = trim((string)($input['identifier'] ?? ''));
            $password = (string)($input['password'] ?? '');
            if ($identifier === '' || $password === '') fail('Kullanıcı adı/e-posta ve parola gerekli.');
            $stmt = $db->prepare('SELECT id, username, display_name, email, email_verified_at, password_hash, status FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1');
            $stmt->execute([$identifier, $identifier]);
            $row = $stmt->fetch();
            if (!$row || !password_verify($password, (string)$row['password_hash'])) fail('Kullanıcı bilgileri doğrulanamadı.', 401, 'invalid_credentials');
            if ($row['status'] !== 'active') fail('Bu hesap şu anda kullanıma kapalı.', 403, 'account_suspended');
            if (empty($row['email'])) fail('Bu eski hesap için e-posta doğrulaması gerekmiyor.', 409, 'verification_not_required');
            if (!empty($row['email_verified_at'])) respond(['ok' => true, 'alreadyVerified' => true]);
            $token = issue_verification($db, (int)$row['id']);
            if (!send_verification_email((string)$row['email'], (string)$row['display_name'], $token)) {
                fail('Doğrulama e-postası gönderilemedi. Sunucu e-posta ayarlarını kontrol et.', 503, 'email_delivery_failed');
            }
            respond(['ok' => true, 'resent' => true]);

        case 'login':
            require_method('POST');
            $input = request_data();
            $identifier = trim((string)($input['identifier'] ?? $input['username'] ?? ''));
            $password = (string)($input['password'] ?? '');
            $stmt = $db->prepare('SELECT id, username, display_name, email, email_verified_at, password_hash, role, status, research_access FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1');
            $stmt->execute([$identifier, $identifier]);
            $row = $stmt->fetch();
            if (!$row || !password_verify($password, (string)$row['password_hash'])) fail('Kullanıcı adı/e-posta veya parola hatalı.', 401, 'invalid_credentials');
            if ($row['status'] !== 'active') fail('Bu üyelik şu anda kullanıma kapalı.', 403, 'account_suspended');
            if (!empty($row['email']) && empty($row['email_verified_at'])) fail('Önce e-posta adresini doğrulamalısın.', 403, 'email_not_verified');
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int)$row['id'];
            $db->prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')->execute([(int)$row['id']]);
            respond(['ok' => true, 'authenticated' => true, 'user' => community_public_user($db, $row)]);

        case 'logout':
            require_method('POST');
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $params = session_get_cookie_params();
                setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool)$params['secure'], (bool)$params['httponly']);
            }
            session_destroy();
            respond(['ok' => true]);

        case 'forum_threads':
            require_method('GET');
            $user = require_user($db);
            $where = user_can_view_special($user) ? '' : "WHERE t.visibility = 'community'";
            $threads = $db->query(<<<SQL
SELECT t.id, t.title, t.visibility, t.is_locked, t.created_at, t.updated_at,
       u.username, u.display_name, COUNT(p.id) AS post_count
FROM forum_threads t
JOIN users u ON u.id = t.user_id
LEFT JOIN forum_posts p ON p.thread_id = t.id
{$where}
GROUP BY t.id
ORDER BY t.updated_at DESC, t.id DESC
LIMIT 100
SQL)->fetchAll();
            $threads = array_map(static fn(array $row): array => [
                'id' => (int)$row['id'],
                'title' => (string)$row['title'],
                'visibility' => (string)$row['visibility'],
                'locked' => (bool)$row['is_locked'],
                'createdAt' => (string)$row['created_at'],
                'updatedAt' => (string)$row['updated_at'],
                'postCount' => (int)$row['post_count'],
                'author' => ['username' => (string)$row['username'], 'displayName' => (string)$row['display_name']],
            ], $threads);
            respond(['ok' => true, 'threads' => $threads]);

        case 'forum_thread':
            require_method('GET');
            $user = require_user($db);
            $threadId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
            if (!$threadId) fail('Geçerli bir konu kimliği gerekli.');
            $thread = admin_forum_thread($db, (int)$threadId);
            if (!$thread || ($thread['visibility'] === 'special' && !user_can_view_special($user))) fail('Konu bulunamadı.', 404, 'thread_not_found');
            respond(['ok' => true, 'thread' => $thread]);

        case 'forum_create':
            require_method('POST');
            $user = require_user($db);
            $input = request_data();
            $title = normalize_title((string)($input['title'] ?? ''));
            $body = normalize_post((string)($input['body'] ?? ''));
            $result = create_forum_thread($db, $user, $title, $body, 'community');
            respond(['ok' => true, ...$result], 201);

        case 'forum_reply':
            require_method('POST');
            $user = require_user($db);
            $input = request_data();
            $threadId = filter_var($input['threadId'] ?? null, FILTER_VALIDATE_INT);
            if (!$threadId) fail('Geçerli bir konu kimliği gerekli.');
            $body = normalize_post((string)($input['body'] ?? ''));
            $stmt = $db->prepare('SELECT is_locked, visibility FROM forum_threads WHERE id = ?');
            $stmt->execute([$threadId]);
            $thread = $stmt->fetch();
            if (!$thread || ($thread['visibility'] === 'special' && !user_can_view_special($user))) fail('Konu bulunamadı.', 404, 'thread_not_found');
            if ((bool)$thread['is_locked']) fail('Bu konu yeni yanıtlara kapalı.', 409, 'thread_locked');
            $db->beginTransaction();
            try {
                $stmt = $db->prepare('INSERT INTO forum_posts (thread_id, user_id, body) VALUES (?, ?, ?)');
                $stmt->execute([$threadId, (int)$user['id'], $body]);
                $postId = (int)$db->lastInsertId();
                $attachment = attachment_from_request($db, $postId);
                $db->prepare('UPDATE forum_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')->execute([$threadId]);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
            respond(['ok' => true, 'postId' => $postId, 'attachment' => $attachment], 201);

        case 'research_area':
            require_method('GET');
            $user = require_user($db);
            if (!user_can_view_special($user)) fail('İçerik bulunamadı.', 404, 'not_found');
            $specialCount = (int)$db->query("SELECT COUNT(*) FROM forum_threads WHERE visibility = 'special'")->fetchColumn();
            respond(['ok' => true, 'area' => [
                'title' => 'Özel Paylaşımlar',
                'eyebrow' => 'ÖZEL YETKİ',
                'intro' => 'Yönetici tarafından özel olarak paylaşılan forum kayıtlarını görme yetkin açık.',
                'threadCount' => $specialCount,
            ]]);

        case 'admin_me':
            require_method('GET');
            $admin = require_verified_admin($db);
            respond(['ok' => true, 'admin' => community_public_user($db, $admin)]);

        case 'admin_users':
            require_method('GET');
            require_verified_admin($db);
            $rows = $db->query(<<<'SQL'
SELECT u.id, u.username, u.display_name, u.email, u.email_verified_at, u.role, u.status, u.research_access, u.created_at, u.last_login_at,
       COUNT(DISTINCT t.id) AS thread_count, COUNT(DISTINCT p.id) AS post_count
FROM users u
LEFT JOIN forum_threads t ON t.user_id = u.id
LEFT JOIN forum_posts p ON p.user_id = u.id
GROUP BY u.id
ORDER BY u.created_at ASC, u.id ASC
SQL)->fetchAll();
            respond(['ok' => true, 'users' => array_map('community_public_admin_user', $rows)]);

        case 'admin_set_special':
        case 'admin_set_research':
            require_method('POST');
            require_verified_admin($db);
            $input = request_data();
            $userId = filter_var($input['userId'] ?? null, FILTER_VALIDATE_INT);
            if (!$userId) fail('Geçerli bir kullanıcı kimliği gerekli.');
            $enabled = filter_var($input['enabled'] ?? false, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($enabled === null) fail('Özel yetki true veya false olmalıdır.');
            $stmt = $db->prepare('UPDATE users SET research_access = ? WHERE id = ?');
            $stmt->execute([$enabled ? 1 : 0, $userId]);
            if ($stmt->rowCount() < 1) {
                $exists = $db->prepare('SELECT 1 FROM users WHERE id = ?');
                $exists->execute([$userId]);
                if (!$exists->fetchColumn()) fail('Kullanıcı bulunamadı.', 404, 'user_not_found');
            }
            respond(['ok' => true, 'userId' => (int)$userId, 'specialAccess' => (bool)$enabled, 'researchAccess' => (bool)$enabled]);

        case 'admin_set_status':
            require_method('POST');
            $admin = require_verified_admin($db);
            $input = request_data();
            $userId = filter_var($input['userId'] ?? null, FILTER_VALIDATE_INT);
            if (!$userId) fail('Geçerli bir kullanıcı kimliği gerekli.');
            $status = (string)($input['status'] ?? '');
            if (!in_array($status, ['active', 'suspended'], true)) fail('Geçersiz hesap durumu.');
            if ((int)$admin['id'] === (int)$userId && $status === 'suspended') fail('Aktif Studio yöneticisi kendi üyeliğini iptal edemez.', 409, 'cannot_suspend_self');
            $stmt = $status === 'suspended'
                ? $db->prepare('UPDATE users SET status = ?, research_access = 0 WHERE id = ?')
                : $db->prepare('UPDATE users SET status = ? WHERE id = ?');
            $stmt->execute([$status, $userId]);
            if ($stmt->rowCount() < 1) {
                $exists = $db->prepare('SELECT 1 FROM users WHERE id = ?');
                $exists->execute([$userId]);
                if (!$exists->fetchColumn()) fail('Kullanıcı bulunamadı.', 404, 'user_not_found');
            }
            respond(['ok' => true, 'userId' => (int)$userId, 'status' => $status, 'specialAccess' => $status === 'suspended' ? false : null]);

        case 'admin_forum_create':
            require_method('POST');
            $admin = require_verified_admin($db);
            $input = request_data();
            $title = normalize_title((string)($input['title'] ?? ''));
            $body = normalize_post((string)($input['body'] ?? ''));
            $visibility = normalize_visibility((string)($input['visibility'] ?? 'community'));
            $result = create_forum_thread($db, $admin, $title, $body, $visibility);
            respond(['ok' => true, 'visibility' => $visibility, ...$result], 201);

        case 'admin_forum_threads':
            require_method('GET');
            require_verified_admin($db);
            $rows = $db->query(<<<'SQL'
SELECT t.id, t.title, t.visibility, t.is_locked, t.created_at, t.updated_at,
       u.username, u.display_name, COUNT(p.id) AS post_count
FROM forum_threads t
JOIN users u ON u.id = t.user_id
LEFT JOIN forum_posts p ON p.thread_id = t.id
GROUP BY t.id
ORDER BY t.updated_at DESC, t.id DESC
LIMIT 200
SQL)->fetchAll();
            $threads = array_map(static fn(array $row): array => [
                'id' => (int)$row['id'],
                'title' => (string)$row['title'],
                'visibility' => (string)$row['visibility'],
                'locked' => (bool)$row['is_locked'],
                'createdAt' => (string)$row['created_at'],
                'updatedAt' => (string)$row['updated_at'],
                'postCount' => (int)$row['post_count'],
                'author' => ['username' => (string)$row['username'], 'displayName' => (string)$row['display_name']],
            ], $rows);
            respond(['ok' => true, 'threads' => $threads]);

        case 'admin_forum_thread':
            require_method('GET');
            require_verified_admin($db);
            $threadId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
            if (!$threadId) fail('Geçerli bir konu kimliği gerekli.');
            $thread = admin_forum_thread($db, (int)$threadId);
            if (!$thread) fail('Konu bulunamadı.', 404, 'thread_not_found');
            respond(['ok' => true, 'thread' => $thread]);

        case 'admin_forum_update':
            require_method('POST');
            require_verified_admin($db);
            $input = request_data();
            $threadId = filter_var($input['threadId'] ?? null, FILTER_VALIDATE_INT);
            if (!$threadId) fail('Geçerli bir konu kimliği gerekli.');
            $visibility = normalize_visibility((string)($input['visibility'] ?? 'community'));
            $locked = filter_var($input['locked'] ?? false, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($locked === null) fail('Kilit durumu true veya false olmalıdır.');
            $stmt = $db->prepare('UPDATE forum_threads SET visibility = ?, is_locked = ? WHERE id = ?');
            $stmt->execute([$visibility, $locked ? 1 : 0, $threadId]);
            if ($stmt->rowCount() < 1) {
                $exists = $db->prepare('SELECT 1 FROM forum_threads WHERE id = ?');
                $exists->execute([$threadId]);
                if (!$exists->fetchColumn()) fail('Konu bulunamadı.', 404, 'thread_not_found');
            }
            respond(['ok' => true, 'threadId' => (int)$threadId, 'visibility' => $visibility, 'locked' => (bool)$locked]);

        case 'admin_forum_delete_thread':
            require_method('POST');
            require_verified_admin($db);
            $input = request_data();
            $threadId = filter_var($input['threadId'] ?? null, FILTER_VALIDATE_INT);
            if (!$threadId) fail('Geçerli bir konu kimliği gerekli.');
            $fileStmt = $db->prepare(<<<'SQL'
SELECT a.stored_name
FROM forum_attachments a
JOIN forum_posts p ON p.id = a.post_id
WHERE p.thread_id = ?
SQL);
            $fileStmt->execute([$threadId]);
            $storedNames = $fileStmt->fetchAll(PDO::FETCH_COLUMN);
            $stmt = $db->prepare('DELETE FROM forum_threads WHERE id = ?');
            $stmt->execute([$threadId]);
            if ($stmt->rowCount() < 1) fail('Konu bulunamadı.', 404, 'thread_not_found');
            remove_stored_attachments($storedNames);
            respond(['ok' => true, 'deleted' => true, 'threadId' => (int)$threadId]);

        case 'admin_forum_delete_post':
            require_method('POST');
            require_verified_admin($db);
            $input = request_data();
            $postId = filter_var($input['postId'] ?? null, FILTER_VALIDATE_INT);
            if (!$postId) fail('Geçerli bir mesaj kimliği gerekli.');
            $stmt = $db->prepare(<<<'SQL'
SELECT p.id, p.thread_id,
       (SELECT MIN(first_post.id) FROM forum_posts first_post WHERE first_post.thread_id = p.thread_id) AS first_post_id
FROM forum_posts p
WHERE p.id = ?
SQL);
            $stmt->execute([$postId]);
            $post = $stmt->fetch();
            if (!$post) fail('Mesaj bulunamadı.', 404, 'post_not_found');
            if ((int)$post['first_post_id'] === (int)$postId) {
                fail('Başlangıç mesajı tek başına silinemez; bunun yerine konuyu sil.', 409, 'first_post_requires_thread_delete');
            }
            $fileStmt = $db->prepare('SELECT stored_name FROM forum_attachments WHERE post_id = ?');
            $fileStmt->execute([$postId]);
            $storedNames = $fileStmt->fetchAll(PDO::FETCH_COLUMN);
            $threadId = (int)$post['thread_id'];
            $db->beginTransaction();
            try {
                $db->prepare('DELETE FROM forum_posts WHERE id = ?')->execute([$postId]);
                $db->prepare(<<<'SQL'
UPDATE forum_threads
SET updated_at = COALESCE((SELECT MAX(created_at) FROM forum_posts WHERE thread_id = ?), created_at)
WHERE id = ?
SQL)->execute([$threadId, $threadId]);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
            remove_stored_attachments($storedNames);
            respond(['ok' => true, 'deleted' => true, 'postId' => (int)$postId, 'threadId' => $threadId]);

        default:
            fail('Bilinmeyen community işlemi.', 404, 'not_found');
    }
} catch (Throwable $error) {
    error_log('[birdesengor-community] ' . $error->getMessage());
    fail('Community servisi isteği tamamlayamadı.', 500, 'server_error');
}
