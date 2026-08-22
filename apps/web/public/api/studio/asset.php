<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

function publication_asset_directory(): string {
    $configured = getenv('CHANNEL_FOUNDRY_PUBLICATION_ASSET_DIR');
    return $configured ?: account_root() . '/www/content/assets';
}

function request_header(string $name): string {
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string)($_SERVER[$key] ?? ''));
}

try {
    require_method('PUT');
    $db = community_db();
    $admin = require_admin($db);

    $filename = request_header('X-Channel-Foundry-Filename');
    $expectedSha = strtolower(request_header('X-Channel-Foundry-Sha256'));
    if (!preg_match('/^[A-Za-z0-9._-]+\.(png|jpg|webp)$/i', $filename)) {
        fail('Publication asset dosya adı geçersiz.', 422, 'invalid_asset');
    }
    if (!preg_match('/^[a-f0-9]{64}$/', $expectedSha)) {
        fail('Publication asset SHA-256 değeri geçersiz.', 422, 'invalid_asset');
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') fail('Publication asset dosyası boş.', 422, 'invalid_asset');
    if (strlen($raw) > 25 * 1024 * 1024) fail('Publication asset 25 MB sınırını aşıyor.', 413, 'payload_too_large');

    $actualSha = hash('sha256', $raw);
    if (!hash_equals($expectedSha, $actualSha)) fail('Publication asset SHA-256 doğrulaması başarısız.', 422, 'asset_hash_mismatch');

    $image = @getimagesizefromstring($raw);
    $mime = is_array($image) ? (string)($image['mime'] ?? '') : '';
    $allowed = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];
    if (!isset($allowed[$mime])) fail('Yalnız PNG, JPG ve WebP publication asset dosyaları kabul edilir.', 422, 'invalid_asset');
    $extension = strtolower((string)pathinfo($filename, PATHINFO_EXTENSION));
    if ($allowed[$mime] !== $extension) fail('Publication asset uzantısı dosya içeriğiyle eşleşmiyor.', 422, 'invalid_asset');

    $directory = publication_asset_directory();
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        fail('Publication asset dizini oluşturulamadı.', 500, 'storage_error');
    }
    $target = $directory . '/' . $filename;
    if (!is_file($target) || !hash_equals($actualSha, hash_file('sha256', $target))) {
        $temporary = $target . '.tmp.' . getmypid() . '.' . bin2hex(random_bytes(4));
        if (file_put_contents($temporary, $raw, LOCK_EX) === false) fail('Geçici publication asset yazılamadı.', 500, 'storage_error');
        if (!rename($temporary, $target)) {
            @unlink($temporary);
            fail('Publication asset etkinleştirilemedi.', 500, 'storage_error');
        }
        @chmod($target, 0644);
    }

    respond([
        'ok' => true,
        'uploaded' => true,
        'filename' => $filename,
        'url' => '/content/assets/' . $filename,
        'sha256' => $actualSha,
        'bytes' => strlen($raw),
        'admin' => ['id' => (int)$admin['id'], 'username' => (string)$admin['username']],
    ]);
} catch (Throwable $error) {
    error_log('[channel-foundry-publication-asset] ' . $error->getMessage());
    fail('Publication asset isteği tamamlanamadı.', 500, 'server_error');
}
