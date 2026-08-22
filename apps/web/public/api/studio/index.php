<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/publication.php';

try {
    $action = (string)($_GET['action'] ?? 'health');
    if ($action === 'health') {
        require_method('GET');
        respond(['ok' => true, 'service' => 'channel-foundry-studio-publish-v2']);
    }
    if ($action !== 'publish') fail('Bilinmeyen Studio işlemi.', 404, 'not_found');

    require_method('POST');
    $db = community_db();
    $admin = require_admin($db);
    $input = request_json(16 * 1024 * 1024);
    $rawPublication = $input['publication'] ?? null;
    if (!is_array($rawPublication)) fail('Publication v2 paketi eksik.', 422, 'invalid_publication');

    $validated = publication_validate($rawPublication);
    $write = publication_write($validated['publication']);
    publication_cleanup_assets($validated['assetFiles']);

    respond([
        'ok' => true,
        'published' => true,
        'schemaVersion' => 2,
        'publicationId' => $validated['publicationId'],
        'generatedAt' => $validated['generatedAt'],
        'contentFingerprint' => $validated['contentFingerprint'],
        'sectionCount' => $validated['sectionCount'],
        'entityCount' => $validated['entityCount'],
        'relationCount' => $validated['relationCount'],
        'assetCount' => $validated['assetCount'],
        'sponsorCount' => $validated['sponsorCount'],
        'contributorCount' => $validated['contributorCount'],
        'bytes' => $write['bytes'],
        'sha256' => $write['sha256'],
        'creditsBytes' => $write['creditsBytes'],
        'creditsSha256' => $write['creditsSha256'],
        'admin' => ['id' => (int)$admin['id'], 'username' => (string)$admin['username']],
    ]);
} catch (Throwable $error) {
    error_log('[channel-foundry-studio-publish-v2] ' . $error->getMessage());
    fail('Studio publication v2 isteği tamamlanamadı.', 500, 'server_error');
}
