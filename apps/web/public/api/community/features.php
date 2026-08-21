<?php
declare(strict_types=1);

const COMMUNITY_MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

function request_data(): array {
    $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
    if (str_contains($contentType, 'multipart/form-data') || str_contains($contentType, 'application/x-www-form-urlencoded')) {
        return is_array($_POST) ? $_POST : [];
    }
    return request_json();
}

function community_storage_dir(): string {
    $configured = trim((string)(getenv('BIRDESENGOR_COMMUNITY_DB') ?: ''));
    if ($configured !== '') return dirname($configured);
    return dirname(__DIR__, 3) . '/community';
}

function community_upload_dir(): string {
    return community_storage_dir() . '/uploads';
}

function community_column_exists(PDO $db, string $table, string $column): bool {
    $stmt = $db->query('PRAGMA table_info(' . $table . ')');
    foreach ($stmt->fetchAll() as $row) {
        if (($row['name'] ?? null) === $column) return true;
    }
    return false;
}

function ensure_community_features(PDO $db): void {
    if (!community_column_exists($db, 'users', 'email')) $db->exec('ALTER TABLE users ADD COLUMN email TEXT');
    if (!community_column_exists($db, 'users', 'email_verified_at')) $db->exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
    if (!community_column_exists($db, 'forum_threads', 'visibility')) $db->exec("ALTER TABLE forum_threads ADD COLUMN visibility TEXT NOT NULL DEFAULT 'community'");

    $db->exec(<<<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_threads_visibility ON forum_threads(visibility, updated_at DESC);
CREATE TABLE IF NOT EXISTS email_verifications (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expiry ON email_verifications(expires_at);
CREATE TABLE IF NOT EXISTS forum_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    stored_name TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_forum_attachments_post ON forum_attachments(post_id);
SQL);

    $uploadDir = community_upload_dir();
    if (!is_dir($uploadDir) && !mkdir($uploadDir, 0770, true) && !is_dir($uploadDir)) {
        fail('Community dosya dizini oluşturulamadı.', 500, 'storage_error');
    }
}

function normalize_email(string $value): string {
    $value = mb_strtolower(trim($value), 'UTF-8');
    if (mb_strlen($value) > 254 || filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
        fail('Geçerli bir e-posta adresi girilmelidir.');
    }
    return $value;
}

function normalize_visibility(string $value): string {
    return $value === 'special' ? 'special' : 'community';
}

function user_can_view_special(array $user): bool {
    return ($user['role'] ?? '') === 'admin' || (bool)($user['research_access'] ?? false);
}

function community_extended_user(PDO $db, array $row): array {
    if (array_key_exists('email', $row) && array_key_exists('email_verified_at', $row)) return $row;
    $stmt = $db->prepare('SELECT id, username, display_name, email, email_verified_at, role, status, research_access, created_at, last_login_at FROM users WHERE id = ?');
    $stmt->execute([(int)$row['id']]);
    return $stmt->fetch() ?: $row;
}

function community_public_user(PDO $db, array $row): array {
    $row = community_extended_user($db, $row);
    $specialAccess = (bool)($row['research_access'] ?? false);
    return [
        'id' => (int)$row['id'],
        'username' => (string)$row['username'],
        'displayName' => (string)$row['display_name'],
        'role' => (string)$row['role'],
        'email' => isset($row['email']) && $row['email'] !== null ? (string)$row['email'] : null,
        'emailVerified' => empty($row['email']) || !empty($row['email_verified_at']),
        'specialAccess' => $specialAccess,
        'researchAccess' => $specialAccess,
    ];
}

function community_public_admin_user(array $row): array {
    $specialAccess = (bool)($row['research_access'] ?? false);
    return [
        'id' => (int)$row['id'],
        'username' => (string)$row['username'],
        'displayName' => (string)$row['display_name'],
        'email' => isset($row['email']) && $row['email'] !== null ? (string)$row['email'] : null,
        'emailVerified' => empty($row['email']) || !empty($row['email_verified_at']),
        'role' => (string)$row['role'],
        'status' => (string)$row['status'],
        'specialAccess' => $specialAccess,
        'researchAccess' => $specialAccess,
        'createdAt' => (string)$row['created_at'],
        'lastLoginAt' => $row['last_login_at'] === null ? null : (string)$row['last_login_at'],
        'threadCount' => isset($row['thread_count']) ? (int)$row['thread_count'] : 0,
        'postCount' => isset($row['post_count']) ? (int)$row['post_count'] : 0,
    ];
}

function require_verified_admin(PDO $db): array {
    $admin = require_admin($db);
    $admin = community_extended_user($db, $admin);
    if (!empty($admin['email']) && empty($admin['email_verified_at'])) {
        fail('Yönetici hesabının e-posta adresi henüz doğrulanmamış.', 403, 'admin_email_not_verified');
    }
    return $admin;
}

function public_base_url(): string {
    $configured = trim((string)(getenv('BIRDESENGOR_PUBLIC_URL') ?: ''));
    if ($configured !== '') return rtrim($configured, '/');
    $host = trim((string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '') return '';
    $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    return ($isSecure ? 'https://' : 'http://') . $host;
}

function issue_verification(PDO $db, int $userId): string {
    $token = bin2hex(random_bytes(32));
    $hash = hash('sha256', $token);
    $expires = gmdate('Y-m-d H:i:s', time() + 24 * 60 * 60);
    $stmt = $db->prepare(<<<'SQL'
INSERT INTO email_verifications (user_id, token_hash, expires_at, created_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP
SQL);
    $stmt->execute([$userId, $hash, $expires]);
    return $token;
}

function verification_url(string $token): string {
    $base = public_base_url();
    if ($base === '') fail('Doğrulama bağlantısı oluşturulamadı.', 500, 'verification_url_error');
    return $base . '/api/community/?action=verify&token=' . rawurlencode($token);
}

function verification_redirect(string $state): never {
    header('Location: /?community=' . rawurlencode($state), true, 303);
    exit;
}

function smtp_settings(): array {
    $host = trim((string)(getenv('BIRDESENGOR_SMTP_HOST') ?: 'smtp-birdesengor.alwaysdata.net'));
    $port = (int)(getenv('BIRDESENGOR_SMTP_PORT') ?: 465);
    $username = trim((string)(getenv('BIRDESENGOR_SMTP_USER') ?: ''));
    $password = (string)(getenv('BIRDESENGOR_SMTP_PASSWORD') ?: '');
    $from = trim((string)(getenv('BIRDESENGOR_SMTP_FROM') ?: 'birdesengor@alwaysdata.net'));
    $encryption = strtolower(trim((string)(getenv('BIRDESENGOR_SMTP_ENCRYPTION') ?: ($port === 587 ? 'starttls' : 'ssl'))));
    if (!in_array($encryption, ['ssl', 'starttls', 'none'], true)) $encryption = 'ssl';
    return compact('host', 'port', 'username', 'password', 'from', 'encryption');
}

function smtp_configured(): bool {
    $settings = smtp_settings();
    $hasUsername = $settings['username'] !== '';
    $hasPassword = $settings['password'] !== '';
    return $settings['host'] !== '' && $settings['port'] > 0
        && filter_var($settings['from'], FILTER_VALIDATE_EMAIL) !== false
        && $hasUsername === $hasPassword;
}

function smtp_read_response($socket): array {
    $lines = [];
    while (($line = fgets($socket, 4096)) !== false) {
        $line = rtrim($line, "\r\n");
        $lines[] = $line;
        if (strlen($line) >= 4 && $line[3] !== '-') break;
    }
    if (!$lines) throw new RuntimeException('SMTP sunucusundan yanıt alınamadı.');
    return [(int)substr($lines[0], 0, 3), implode("\n", $lines)];
}

function smtp_expect($socket, array $expected, ?string $command = null, bool $sensitive = false): void {
    if ($command !== null && fwrite($socket, $command . "\r\n") === false) throw new RuntimeException('SMTP isteği gönderilemedi.');
    [$code, $message] = smtp_read_response($socket);
    if (!in_array($code, $expected, true)) {
        $label = $command === null || $sensitive ? 'SMTP' : strtok($command, ' ');
        throw new RuntimeException($label . ' işlemi başarısız: ' . $message);
    }
}

function smtp_send(string $recipient, string $subject, string $body): bool {
    $settings = smtp_settings();
    if (!smtp_configured()) throw new RuntimeException('SMTP ayarları eksik veya tutarsız.');
    if (filter_var($recipient, FILTER_VALIDATE_EMAIL) === false) throw new RuntimeException('Alıcı e-posta adresi geçersiz.');

    $transport = $settings['encryption'] === 'ssl' ? 'ssl://' : 'tcp://';
    $context = stream_context_create(['ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
        'peer_name' => $settings['host'],
        'SNI_enabled' => true,
    ]]);
    $socket = @stream_socket_client($transport . $settings['host'] . ':' . $settings['port'], $errno, $errstr, 12, STREAM_CLIENT_CONNECT, $context);
    if (!is_resource($socket)) throw new RuntimeException("SMTP bağlantısı kurulamadı: {$errstr} ({$errno})");
    stream_set_timeout($socket, 12);

    try {
        smtp_expect($socket, [220]);
        $helo = preg_replace('/[^A-Za-z0-9.-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'birdesengor.local')) ?: 'birdesengor.local';
        smtp_expect($socket, [250], 'EHLO ' . $helo);
        if ($settings['encryption'] === 'starttls') {
            smtp_expect($socket, [220], 'STARTTLS');
            if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('SMTP STARTTLS bağlantısı kurulamadı.');
            smtp_expect($socket, [250], 'EHLO ' . $helo);
        }
        if ($settings['username'] !== '') {
            smtp_expect($socket, [334], 'AUTH LOGIN');
            smtp_expect($socket, [334], base64_encode($settings['username']), true);
            smtp_expect($socket, [235], base64_encode($settings['password']), true);
        }
        smtp_expect($socket, [250], 'MAIL FROM:<' . $settings['from'] . '>');
        smtp_expect($socket, [250, 251], 'RCPT TO:<' . $recipient . '>');
        smtp_expect($socket, [354], 'DATA');

        $headers = [
            'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
            'From: =?UTF-8?B?' . base64_encode('BirDeSenGör') . '?= <' . $settings['from'] . '>',
            'To: <' . $recipient . '>',
            'Subject: ' . $subject,
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . (preg_replace('/[^A-Za-z0-9.-]/', '', $settings['host']) ?: 'birdesengor.local') . '>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
        ];
        $normalizedBody = preg_replace("/\r\n|\r|\n/", "\r\n", $body) ?? $body;
        $normalizedBody = preg_replace('/(?m)^\./', '..', $normalizedBody) ?? $normalizedBody;
        $payload = implode("\r\n", $headers) . "\r\n\r\n" . $normalizedBody . "\r\n.\r\n";
        if (fwrite($socket, $payload) === false) throw new RuntimeException('SMTP ileti gövdesi gönderilemedi.');
        smtp_expect($socket, [250]);
        try { smtp_expect($socket, [221], 'QUIT'); } catch (Throwable) {}
        return true;
    } finally {
        fclose($socket);
    }
}

function send_verification_email(string $email, string $displayName, string $token): bool {
    $url = verification_url($token);
    $subject = '=?UTF-8?B?' . base64_encode('BirDeSenGör topluluk üyeliğini doğrula') . '?=';
    $safeName = str_replace(["\r", "\n"], '', $displayName);
    $body = "Merhaba {$safeName},\n\nBirDeSenGör topluluk üyeliğini doğrulamak için aşağıdaki bağlantıyı aç:\n{$url}\n\n"
        . "Bağlantı 24 saat geçerlidir. Bu kaydı sen oluşturmadıysan bu e-postayı yok sayabilirsin.\n";
    try {
        return smtp_send($email, $subject, $body);
    } catch (Throwable $error) {
        error_log('[birdesengor-community] verification mail: ' . $error->getMessage());
        return false;
    }
}

function attachment_from_request(PDO $db, int $postId): ?array {
    if (!isset($_FILES['attachment']) || !is_array($_FILES['attachment'])) return null;
    $upload = $_FILES['attachment'];
    $error = (int)($upload['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($error === UPLOAD_ERR_NO_FILE) return null;
    if ($error !== UPLOAD_ERR_OK) fail('Dosya yüklenemedi.', 400, 'attachment_upload_failed');

    $tmp = (string)($upload['tmp_name'] ?? '');
    $original = trim((string)($upload['name'] ?? ''));
    $size = (int)($upload['size'] ?? 0);
    if ($tmp === '' || !is_uploaded_file($tmp) || $size < 1) fail('Yüklenen dosya okunamadı.', 400, 'attachment_invalid');
    if ($size > COMMUNITY_MAX_ATTACHMENT_BYTES) fail('Dosya 12 MB sınırını aşıyor.', 413, 'attachment_too_large');

    $original = basename(str_replace('\\', '/', $original));
    $original = preg_replace('/[\x00-\x1F\x7F]+/u', '', $original) ?? '';
    if ($original === '') $original = 'dosya';
    if (mb_strlen($original) > 160) $original = mb_substr($original, 0, 160);
    $extension = strtolower((string)pathinfo($original, PATHINFO_EXTENSION));
    $allowed = ['pdf', 'txt', 'md', 'csv', 'json', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'zip', 'docx', 'xlsx', 'pptx'];
    if ($extension === '' || !in_array($extension, $allowed, true)) fail('Bu dosya türü paylaşım için desteklenmiyor.', 415, 'attachment_type_not_allowed');

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = (string)($finfo->file($tmp) ?: 'application/octet-stream');
    $stored = bin2hex(random_bytes(20)) . '.' . $extension;
    $target = community_upload_dir() . '/' . $stored;
    if (!move_uploaded_file($tmp, $target)) fail('Dosya güvenli depolama alanına taşınamadı.', 500, 'attachment_storage_error');
    @chmod($target, 0660);
    $sha256 = hash_file('sha256', $target);
    if (!is_string($sha256)) { @unlink($target); fail('Dosya doğrulaması tamamlanamadı.', 500, 'attachment_hash_error'); }

    try {
        $stmt = $db->prepare('INSERT INTO forum_attachments (post_id, stored_name, original_name, mime_type, size_bytes, sha256) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$postId, $stored, $original, $mime, $size, $sha256]);
        $id = (int)$db->lastInsertId();
    } catch (Throwable $error) {
        @unlink($target);
        throw $error;
    }
    return ['id' => $id, 'name' => $original, 'mimeType' => $mime, 'sizeBytes' => $size, 'sha256' => $sha256, 'url' => '/api/community/file.php?id=' . $id];
}

function attachments_for_posts(PDO $db, array $postIds): array {
    $ids = array_values(array_filter(array_map('intval', $postIds), static fn(int $id): bool => $id > 0));
    if (!$ids) return [];
    $stmt = $db->prepare('SELECT id, post_id, original_name, mime_type, size_bytes, sha256 FROM forum_attachments WHERE post_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY id ASC');
    $stmt->execute($ids);
    $byPost = [];
    foreach ($stmt->fetchAll() as $row) {
        $postId = (int)$row['post_id'];
        $byPost[$postId][] = [
            'id' => (int)$row['id'], 'name' => (string)$row['original_name'], 'mimeType' => (string)$row['mime_type'],
            'sizeBytes' => (int)$row['size_bytes'], 'sha256' => (string)$row['sha256'], 'url' => '/api/community/file.php?id=' . (int)$row['id'],
        ];
    }
    return $byPost;
}
