<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/features.php';

require_method('GET');
$db = community_db();
ensure_community_features($db);
$user = require_user($db);
$attachmentId = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
if (!$attachmentId) fail('Geçerli bir dosya kimliği gerekli.');

$stmt = $db->prepare(<<<'SQL'
SELECT a.id, a.stored_name, a.original_name, a.mime_type, a.size_bytes, a.sha256,
       t.visibility
FROM forum_attachments a
JOIN forum_posts p ON p.id = a.post_id
JOIN forum_threads t ON t.id = p.thread_id
WHERE a.id = ?
LIMIT 1
SQL);
$stmt->execute([$attachmentId]);
$row = $stmt->fetch();
if (!$row || ($row['visibility'] === 'special' && !user_can_view_special($user))) {
    fail('Dosya bulunamadı.', 404, 'attachment_not_found');
}

$stored = basename((string)$row['stored_name']);
$file = community_upload_dir() . '/' . $stored;
if (!is_file($file) || !is_readable($file)) fail('Dosya bulunamadı.', 404, 'attachment_not_found');

$actualSize = filesize($file);
if ($actualSize === false || $actualSize !== (int)$row['size_bytes']) fail('Dosya doğrulaması başarısız.', 409, 'attachment_integrity_error');
$actualHash = hash_file('sha256', $file);
if (!is_string($actualHash) || !hash_equals((string)$row['sha256'], $actualHash)) fail('Dosya doğrulaması başarısız.', 409, 'attachment_integrity_error');

$name = (string)$row['original_name'];
$fallback = preg_replace('/[^A-Za-z0-9._-]+/', '_', $name) ?: 'download';
header_remove('Content-Type');
header('Content-Type: ' . ((string)$row['mime_type'] ?: 'application/octet-stream'));
header('Content-Length: ' . (string)$actualSize);
header('Content-Disposition: attachment; filename="' . str_replace('"', '', $fallback) . '"; filename*=UTF-8\'\'' . rawurlencode($name));
header('Content-Security-Policy: default-src \'none\'; sandbox');
header('X-Content-Type-Options: nosniff');
readfile($file);
exit;
