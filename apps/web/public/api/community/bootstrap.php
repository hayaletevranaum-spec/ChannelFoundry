<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_name('birdesengor_community');
session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 30,
    'path' => '/',
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

function respond(array $payload, int $status = 200): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400, string $code = 'bad_request'): never {
    respond(['ok' => false, 'error' => $code, 'message' => $message], $status);
}

function request_json(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return [];
    $value = json_decode($raw, true);
    if (!is_array($value)) fail('Geçersiz JSON isteği.');
    return $value;
}

function require_method(string $method): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $method) {
        header('Allow: ' . $method);
        fail('Bu işlem için geçersiz HTTP yöntemi.', 405, 'method_not_allowed');
    }
}

function assert_same_origin_for_write(): void {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) return;
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($origin === '' || $host === '') return;
    $originHost = parse_url($origin, PHP_URL_HOST);
    if (!is_string($originHost) || strcasecmp($originHost, preg_replace('/:\d+$/', '', $host)) !== 0) {
        fail('İstek kaynağı doğrulanamadı.', 403, 'origin_rejected');
    }
}

function ensure_initial_admin(PDO $db): void {
    $adminCount = (int)$db->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
    if ($adminCount > 0) return;
    $firstId = $db->query('SELECT id FROM users ORDER BY id ASC LIMIT 1')->fetchColumn();
    if ($firstId === false) return;
    $db->prepare("UPDATE users SET role = 'admin' WHERE id = ?")->execute([(int)$firstId]);
}

function community_db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $configured = getenv('BIRDESENGOR_COMMUNITY_DB');
    $databaseFile = $configured ?: dirname(__DIR__, 3) . '/community/community.sqlite';
    $databaseDir = dirname($databaseFile);
    if (!is_dir($databaseDir) && !mkdir($databaseDir, 0770, true) && !is_dir($databaseDir)) {
        fail('Community veri dizini oluşturulamadı.', 500, 'storage_error');
    }
    $pdo = new PDO('sqlite:' . $databaseFile, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    research_access INTEGER NOT NULL DEFAULT 0 CHECK (research_access IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS forum_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS forum_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_forum_threads_updated ON forum_threads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id, created_at ASC);
SQL);
    ensure_initial_admin($pdo);
    return $pdo;
}

function public_user(array $row): array {
    return [
        'id' => (int)$row['id'],
        'username' => (string)$row['username'],
        'displayName' => (string)$row['display_name'],
        'role' => (string)$row['role'],
        'researchAccess' => (bool)$row['research_access'],
    ];
}

function public_admin_user(array $row): array {
    return [
        'id' => (int)$row['id'],
        'username' => (string)$row['username'],
        'displayName' => (string)$row['display_name'],
        'role' => (string)$row['role'],
        'status' => (string)$row['status'],
        'researchAccess' => (bool)$row['research_access'],
        'createdAt' => (string)$row['created_at'],
        'lastLoginAt' => $row['last_login_at'] === null ? null : (string)$row['last_login_at'],
        'threadCount' => isset($row['thread_count']) ? (int)$row['thread_count'] : 0,
        'postCount' => isset($row['post_count']) ? (int)$row['post_count'] : 0,
    ];
}

function current_user(PDO $db): ?array {
    $id = $_SESSION['user_id'] ?? null;
    if (!is_int($id) && !ctype_digit((string)$id)) return null;
    $stmt = $db->prepare('SELECT id, username, display_name, role, status, research_access FROM users WHERE id = ?');
    $stmt->execute([(int)$id]);
    $row = $stmt->fetch();
    if (!$row || $row['status'] !== 'active') {
        unset($_SESSION['user_id']);
        return null;
    }
    return $row;
}

function require_user(PDO $db): array {
    $user = current_user($db);
    if (!$user) fail('Bu alan yalnızca üyelere açıktır.', 401, 'authentication_required');
    return $user;
}

function basic_credentials(): array {
    $username = $_SERVER['PHP_AUTH_USER'] ?? null;
    $password = $_SERVER['PHP_AUTH_PW'] ?? null;
    if (is_string($username) && is_string($password)) return [$username, $password];
    $header = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $header = (string)($headers['Authorization'] ?? $headers['authorization'] ?? '');
    }
    if (!str_starts_with($header, 'Basic ')) return ['', ''];
    $decoded = base64_decode(substr($header, 6), true);
    if (!is_string($decoded) || !str_contains($decoded, ':')) return ['', ''];
    return explode(':', $decoded, 2);
}

function require_admin(PDO $db): array {
    [$username, $password] = basic_credentials();
    if ($username === '' || $password === '') {
        header('WWW-Authenticate: Basic realm="BirDeSenGor Studio"');
        fail('Studio yönetici oturumu gerekli.', 401, 'admin_authentication_required');
    }
    $stmt = $db->prepare('SELECT id, username, display_name, password_hash, role, status, research_access, created_at, last_login_at FROM users WHERE username = ? COLLATE NOCASE');
    $stmt->execute([$username]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, (string)$row['password_hash'])) fail('Yönetici kullanıcı adı veya parola hatalı.', 401, 'invalid_admin_credentials');
    if ($row['status'] !== 'active') fail('Yönetici hesabı kullanıma kapalı.', 403, 'admin_suspended');
    if ($row['role'] !== 'admin') fail('Bu hesap Studio kullanıcı yönetimine yetkili değil.', 403, 'admin_required');
    return $row;
}

function normalize_username(string $value): string {
    $value = trim($value);
    if (!preg_match('/^[\p{L}\p{N}._-]{3,32}$/u', $value)) fail('Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, alt çizgi ve tire kullanılabilir.');
    return $value;
}

function normalize_display_name(string $value, string $fallback): string {
    $value = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    if ($value === '') $value = $fallback;
    $length = mb_strlen($value);
    if ($length < 2 || $length > 80) fail('Görünen ad 2-80 karakter olmalıdır.');
    return $value;
}

function normalize_password(string $value): string {
    if (mb_strlen($value) < 8 || mb_strlen($value) > 200) fail('Parola en az 8 karakter olmalıdır.');
    return $value;
}

function normalize_title(string $value): string {
    $value = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    $length = mb_strlen($value);
    if ($length < 4 || $length > 140) fail('Başlık 4-140 karakter olmalıdır.');
    return $value;
}

function normalize_post(string $value): string {
    $value = trim($value);
    $length = mb_strlen($value);
    if ($length < 2 || $length > 12000) fail('Mesaj 2-12000 karakter olmalıdır.');
    return $value;
}
