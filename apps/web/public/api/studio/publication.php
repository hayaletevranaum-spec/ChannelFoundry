<?php
declare(strict_types=1);

function publication_content_directory(): string {
    $configured = getenv('CHANNEL_FOUNDRY_PUBLICATION_CONTENT_DIR');
    return $configured ?: account_root() . '/www/content';
}

function publication_file(): string {
    return publication_content_directory() . '/publication.json';
}

function publication_credits_file(): string {
    return publication_content_directory() . '/community-credits.json';
}

function publication_asset_directory(): string {
    $configured = getenv('CHANNEL_FOUNDRY_PUBLICATION_ASSET_DIR');
    return $configured ?: publication_content_directory() . '/assets';
}

function publication_string(mixed $value, string $field, int $max, bool $allowEmpty = false): string {
    if (!is_string($value)) fail($field . ' metin olmalıdır.', 422, 'invalid_publication');
    $value = trim($value);
    $length = mb_strlen($value);
    if ((!$allowEmpty && $length < 1) || $length > $max) fail($field . ' geçersiz.', 422, 'invalid_publication');
    return $value;
}

function publication_list(mixed $value, string $field, int $max): array {
    if (!is_array($value) || !array_is_list($value)) fail($field . ' liste olmalıdır.', 422, 'invalid_publication');
    if (count($value) > $max) fail($field . ' izin verilen sınırı aşıyor.', 413, 'payload_too_large');
    return $value;
}

function publication_reject_physical_layout(mixed $value): void {
    if (!is_array($value)) return;
    $forbidden = ['page', 'pageNumber', 'pageIndex', 'spread', 'spreadNumber', 'spreadIndex', 'physicalPage', 'physicalSpread'];
    foreach ($value as $key => $entry) {
        if (is_string($key) && in_array($key, $forbidden, true)) {
            fail('Publication v2 fiziksel sayfa/spread bilgisi içeremez.', 422, 'physical_layout_forbidden');
        }
        publication_reject_physical_layout($entry);
    }
}

function publication_validate_support(mixed $value): array {
    if (!is_array($value)) fail('Publication support alanı eksik.', 422, 'invalid_publication');
    $result = ['sponsors' => [], 'contributors' => []];
    $ids = [];
    foreach (['sponsors', 'contributors'] as $kind) {
        $entries = publication_list($value[$kind] ?? null, 'support.' . $kind, 10000);
        foreach ($entries as $entry) {
            if (!is_array($entry)) fail('Support kaydı geçersiz.', 422, 'invalid_publication');
            $id = publication_string($entry['id'] ?? null, 'support.id', 120);
            if (!preg_match('/^[A-Za-z0-9._:-]+$/', $id) || isset($ids[$id])) {
                fail('Support id geçersiz veya tekrarlı.', 422, 'invalid_publication');
            }
            $ids[$id] = true;
            $name = publication_string($entry['name'] ?? null, 'support.name', 500);
            $date = publication_string($entry['date'] ?? '', 'support.date', 40, true);
            if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                fail('Support tarihi YYYY-MM-DD biçiminde olmalıdır.', 422, 'invalid_publication');
            }
            $note = publication_string($entry['note'] ?? '', 'support.note', 2000, true);
            $video = $entry['video'] ?? null;
            if (!is_array($video)) fail('Support video bilgisi geçersiz.', 422, 'invalid_publication');
            $videoId = publication_string($video['id'] ?? '', 'support.video.id', 100, true);
            if ($videoId !== '' && !preg_match('/^[A-Za-z0-9_-]+$/', $videoId)) {
                fail('Support video id geçersiz.', 422, 'invalid_publication');
            }
            $videoTitle = publication_string($video['title'] ?? '', 'support.video.title', 1000, true);
            $videoUrl = publication_string($video['url'] ?? '', 'support.video.url', 1000, true);
            if ($videoUrl !== '') {
                $scheme = strtolower((string)parse_url($videoUrl, PHP_URL_SCHEME));
                if (!filter_var($videoUrl, FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true)) {
                    fail('Support video URL geçersiz.', 422, 'invalid_publication');
                }
            }
            $result[$kind][] = [
                'id' => $id,
                'name' => $name,
                'date' => $date,
                'note' => $note,
                'video' => ['id' => $videoId, 'title' => $videoTitle, 'url' => $videoUrl],
            ];
        }
    }
    return $result;
}

function publication_validate(array $raw): array {
    if (($raw['schemaVersion'] ?? null) !== 2) fail('Yalnız publication schemaVersion 2 destekleniyor.', 422, 'invalid_schema');
    publication_reject_physical_layout($raw);

    $publication = $raw['publication'] ?? null;
    if (!is_array($publication)) fail('Publication metadata eksik.', 422, 'invalid_publication');
    $publicationId = publication_string($publication['id'] ?? null, 'publication.id', 120);
    $generatedAt = publication_string($publication['generatedAt'] ?? null, 'publication.generatedAt', 80);
    $fingerprint = strtolower(publication_string($publication['contentFingerprint'] ?? null, 'publication.contentFingerprint', 64));
    if (!preg_match('/^pub-[a-f0-9]{24}$/', $publicationId)) fail('publication.id geçersiz.', 422, 'invalid_publication');
    if (!preg_match('/^[a-f0-9]{64}$/', $fingerprint)) fail('publication.contentFingerprint geçersiz.', 422, 'invalid_publication');

    $journal = $raw['journal'] ?? null;
    $archive = $raw['archive'] ?? null;
    if (!is_array($journal) || !is_array($archive)) fail('Publication journal/archive alanları eksik.', 422, 'invalid_publication');
    $sections = publication_list($journal['sections'] ?? null, 'journal.sections', 5000);
    $entities = publication_list($archive['entities'] ?? null, 'archive.entities', 10000);
    $relations = publication_list($archive['relations'] ?? null, 'archive.relations', 30000);
    $assets = publication_list($raw['assets'] ?? null, 'assets', 10000);
    $support = publication_validate_support($raw['support'] ?? null);
    $raw['support'] = $support;

    $entityIds = [];
    foreach ($entities as $entity) {
        if (!is_array($entity)) fail('Archive entity kaydı geçersiz.', 422, 'invalid_publication');
        $entityId = publication_string($entity['entityId'] ?? null, 'entityId', 220);
        if (isset($entityIds[$entityId])) fail('Archive entityId tekrarlanamaz.', 422, 'invalid_publication');
        $entityIds[$entityId] = true;
        publication_string($entity['kind'] ?? null, 'entity.kind', 40);
        publication_string($entity['name'] ?? null, 'entity.name', 500);
    }

    foreach ($relations as $relation) {
        if (!is_array($relation)) fail('Archive relation kaydı geçersiz.', 422, 'invalid_publication');
        $from = publication_string($relation['fromEntityId'] ?? null, 'relation.fromEntityId', 220);
        $to = publication_string($relation['toEntityId'] ?? null, 'relation.toEntityId', 220);
        if (!isset($entityIds[$from]) || !isset($entityIds[$to])) fail('Relation onaylı archive entity dışına çıkıyor.', 422, 'invalid_publication');
    }

    $assetIds = [];
    $assetFiles = [];
    $assetDirectory = publication_asset_directory();
    foreach ($assets as $asset) {
        if (!is_array($asset)) fail('Publication asset kaydı geçersiz.', 422, 'invalid_publication');
        $assetId = publication_string($asset['assetId'] ?? null, 'asset.assetId', 220);
        if (isset($assetIds[$assetId])) fail('assetId tekrarlanamaz.', 422, 'invalid_publication');
        $assetIds[$assetId] = true;
        $url = publication_string($asset['url'] ?? null, 'asset.url', 500);
        if (!preg_match('#^assets/([A-Za-z0-9._-]+\.(png|jpg|webp))$#i', $url, $matches)) {
            fail('Publication asset URL yalnız content/assets altına işaret edebilir.', 422, 'invalid_asset');
        }
        $sha = strtolower(publication_string($asset['sha256'] ?? null, 'asset.sha256', 64));
        if (!preg_match('/^[a-f0-9]{64}$/', $sha)) fail('Publication asset SHA-256 geçersiz.', 422, 'invalid_asset');
        $filename = $matches[1];
        $file = $assetDirectory . '/' . $filename;
        if (!is_file($file)) fail('Publication asset sunucuda bulunamadı: ' . $filename, 409, 'asset_missing');
        $actualSha = hash_file('sha256', $file);
        if (!is_string($actualSha) || !hash_equals($sha, $actualSha)) fail('Publication asset hash eşleşmiyor: ' . $filename, 409, 'asset_hash_mismatch');
        if (isset($asset['bytes']) && (int)$asset['bytes'] !== filesize($file)) fail('Publication asset byte sayısı eşleşmiyor: ' . $filename, 409, 'asset_size_mismatch');
        $assetFiles[$filename] = true;
        if (isset($asset['entityId']) && !isset($entityIds[(string)$asset['entityId']])) fail('Asset entityId archive içinde bulunamadı.', 422, 'invalid_publication');
    }

    $sectionIds = [];
    foreach ($sections as $section) {
        if (!is_array($section)) fail('Journal section kaydı geçersiz.', 422, 'invalid_publication');
        $sectionId = publication_string($section['sectionId'] ?? null, 'section.sectionId', 220);
        if (isset($sectionIds[$sectionId])) fail('sectionId tekrarlanamaz.', 422, 'invalid_publication');
        $sectionIds[$sectionId] = true;
        publication_string($section['title'] ?? '', 'section.title', 1000, true);
        $blocks = publication_list($section['blocks'] ?? [], 'section.blocks', 1000);
        foreach ($blocks as $block) {
            if (!is_array($block)) fail('Section block kaydı geçersiz.', 422, 'invalid_publication');
            if (($block['type'] ?? '') === 'figure') {
                $assetId = publication_string($block['assetId'] ?? null, 'figure.assetId', 220);
                if (!isset($assetIds[$assetId])) fail('Figure assetId publication assets içinde bulunamadı.', 422, 'invalid_publication');
            }
            foreach (($block['spans'] ?? []) as $span) {
                if (is_array($span) && ($span['type'] ?? '') === 'reference') {
                    $entityId = publication_string($span['entityId'] ?? null, 'reference.entityId', 220);
                    if (!isset($entityIds[$entityId])) fail('Inline reference archive entity içinde bulunamadı.', 422, 'invalid_publication');
                }
            }
        }
        foreach (publication_list($section['media'] ?? [], 'section.media', 200) as $media) {
            if (!is_array($media)) fail('Section media kaydı geçersiz.', 422, 'invalid_publication');
            $assetId = publication_string($media['assetId'] ?? null, 'media.assetId', 220);
            if (!isset($assetIds[$assetId])) fail('Media assetId publication assets içinde bulunamadı.', 422, 'invalid_publication');
        }
    }

    foreach ($assets as $asset) {
        if (isset($asset['sectionId']) && !isset($sectionIds[(string)$asset['sectionId']])) fail('Asset sectionId journal içinde bulunamadı.', 422, 'invalid_publication');
    }

    return [
        'publication' => $raw,
        'publicationId' => $publicationId,
        'generatedAt' => $generatedAt,
        'contentFingerprint' => $fingerprint,
        'sectionCount' => count($sections),
        'entityCount' => count($entities),
        'relationCount' => count($relations),
        'assetCount' => count($assets),
        'sponsorCount' => count($support['sponsors']),
        'contributorCount' => count($support['contributors']),
        'assetFiles' => $assetFiles,
    ];
}

function publication_write(array $publication): array {
    $file = publication_file();
    $creditsFile = publication_credits_file();
    $directory = dirname($file);
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) fail('Publication içerik dizini oluşturulamadı.', 500, 'storage_error');
    $json = json_encode($publication, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
    $creditsJson = json_encode([
        'schemaVersion' => 1,
        'updatedAt' => $publication['publication']['generatedAt'],
        'sponsors' => $publication['support']['sponsors'],
        'contributors' => $publication['support']['contributors'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
    $temporary = $file . '.tmp.' . getmypid() . '.' . bin2hex(random_bytes(4));
    $creditsTemporary = $creditsFile . '.tmp.' . getmypid() . '.' . bin2hex(random_bytes(4));
    if (file_put_contents($temporary, $json, LOCK_EX) === false) fail('Geçici publication.json yazılamadı.', 500, 'storage_error');
    if (file_put_contents($creditsTemporary, $creditsJson, LOCK_EX) === false) {
        @unlink($temporary);
        fail('Geçici community-credits.json yazılamadı.', 500, 'storage_error');
    }
    if (!rename($temporary, $file)) {
        @unlink($temporary);
        @unlink($creditsTemporary);
        fail('publication.json etkinleştirilemedi.', 500, 'storage_error');
    }
    if (!rename($creditsTemporary, $creditsFile)) {
        @unlink($creditsTemporary);
        fail('community-credits.json etkinleştirilemedi.', 500, 'storage_error');
    }
    @chmod($file, 0644);
    @chmod($creditsFile, 0644);
    return [
        'bytes' => strlen($json),
        'sha256' => hash('sha256', $json),
        'creditsBytes' => strlen($creditsJson),
        'creditsSha256' => hash('sha256', $creditsJson),
    ];
}

function publication_cleanup_assets(array $keep): void {
    $directory = publication_asset_directory();
    if (!is_dir($directory)) return;
    foreach (scandir($directory) ?: [] as $name) {
        if ($name === '.' || $name === '..' || isset($keep[$name])) continue;
        $file = $directory . '/' . $name;
        if (is_file($file) && preg_match('/\.(png|jpg|webp)$/i', $name)) @unlink($file);
    }
}
