<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function respond(array $payload, int $status = 200): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $status = 400, string $code = 'bad_request'): never {
    respond(['ok' => false, 'error' => $code, 'message' => $message], $status);
}

function require_method(string $method): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $method) {
        header('Allow: ' . $method);
        fail('Bu işlem için geçersiz HTTP yöntemi.', 405, 'method_not_allowed');
    }
}

function request_json(int $maxBytes = 8388608): array {
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > $maxBytes) fail('Yayın paketi izin verilen boyutu aşıyor.', 413, 'payload_too_large');
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') fail('Yayın paketi boş.');
    if (strlen($raw) > $maxBytes) fail('Yayın paketi izin verilen boyutu aşıyor.', 413, 'payload_too_large');
    $value = json_decode($raw, true);
    if (!is_array($value)) fail('Geçersiz JSON isteği.');
    return $value;
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

function account_root(): string {
    return dirname(__DIR__, 3);
}

function community_db(): PDO {
    $configured = getenv('CHANNEL_FOUNDRY_COMMUNITY_DB');
    $databaseFile = $configured ?: account_root() . '/community/community.sqlite';
    if (!is_file($databaseFile)) fail('Community yönetici deposu bulunamadı.', 503, 'community_unavailable');
    return new PDO('sqlite:' . $databaseFile, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function require_admin(PDO $db): array {
    [$username, $password] = basic_credentials();
    if ($username === '' || $password === '') {
        header('WWW-Authenticate: Basic realm="Channel Foundry Studio"');
        fail('Studio yönetici oturumu gerekli.', 401, 'admin_authentication_required');
    }
    $stmt = $db->prepare('SELECT id, username, display_name, password_hash, role, status FROM users WHERE username = ? COLLATE NOCASE');
    $stmt->execute([$username]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($password, (string)$row['password_hash'])) fail('Yönetici kullanıcı adı veya parola hatalı.', 401, 'invalid_admin_credentials');
    if ($row['status'] !== 'active') fail('Yönetici hesabı kullanıma kapalı.', 403, 'admin_suspended');
    if ($row['role'] !== 'admin') fail('Bu hesap yayınlama işlemine yetkili değil.', 403, 'admin_required');
    return $row;
}
