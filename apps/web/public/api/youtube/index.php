<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=180');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function respond(array $payload, int $status = 200): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail_response(string $message, int $status = 502): never {
    respond(['ok' => false, 'message' => $message], $status);
}

function request_headers(): array {
    return [
        'Accept: application/json,application/atom+xml,application/xml,text/html;q=0.9,*/*;q=0.8',
        'Accept-Language: tr-TR,tr;q=0.9,en;q=0.7',
        'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    ];
}

function remote_get(string $url): string {
    $headers = request_headers();
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 24,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_ENCODING => '',
        ]);
        $body = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if (!is_string($body) || $body === '' || $status >= 400) {
            throw new RuntimeException($error !== '' ? $error : "HTTP {$status}");
        }
        return $body;
    }

    $context = stream_context_create(['http' => [
        'timeout' => 24,
        'follow_location' => 1,
        'header' => implode("\r\n", $headers),
    ]]);
    $body = @file_get_contents($url, false, $context);
    if (!is_string($body) || $body === '') throw new RuntimeException('Uzak kaynak okunamadı.');
    return $body;
}

function remote_post_json(string $url, array $payload, array $extraHeaders = []): array {
    $raw = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($raw)) throw new RuntimeException('YouTube isteği hazırlanamadı.');
    $headers = array_merge(request_headers(), ['Content-Type: application/json', 'Origin: https://www.youtube.com'], $extraHeaders);

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 24,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $raw,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_ENCODING => '',
        ]);
        $body = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if (!is_string($body) || $body === '' || $status >= 400) {
            throw new RuntimeException($error !== '' ? $error : "HTTP {$status}");
        }
    } else {
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'timeout' => 24,
            'follow_location' => 1,
            'header' => implode("\r\n", $headers),
            'content' => $raw,
        ]]);
        $body = @file_get_contents($url, false, $context);
        if (!is_string($body) || $body === '') throw new RuntimeException('YouTube devam sayfası okunamadı.');
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) throw new RuntimeException('YouTube devam sayfası geçersiz JSON döndürdü.');
    return $decoded;
}

function channel_url(): string {
    $configured = trim((string)getenv('BIRDESENGOR_YOUTUBE_CHANNEL_URL'));
    return $configured !== '' ? $configured : 'https://www.youtube.com/@BirDeSenGor';
}

function extract_channel_id(string $channelUrl): string {
    $configured = trim((string)getenv('BIRDESENGOR_YOUTUBE_CHANNEL_ID'));
    if (preg_match('/^UC[\w-]+$/', $configured)) return $configured;

    $path = (string)(parse_url($channelUrl, PHP_URL_PATH) ?? '');
    if (preg_match('~/channel/(UC[\w-]+)~', $path, $match)) return $match[1];

    $html = remote_get(rtrim($channelUrl, '/') . '?hl=tr&gl=TR');
    foreach ([
        '/"channelId":"(UC[\w-]+)"/',
        '/"externalId":"(UC[\w-]+)"/',
        '/"browseId":"(UC[\w-]+)"/',
        '/<meta itemprop="channelId" content="(UC[\w-]+)"/',
        '~youtube\.com/channel/(UC[\w-]+)~',
    ] as $pattern) {
        if (preg_match($pattern, $html, $match)) return $match[1];
    }
    throw new RuntimeException('YouTube kanal kimliği çözülemedi.');
}

function api_json(string $url): array {
    $decoded = json_decode(remote_get($url), true);
    if (!is_array($decoded)) throw new RuntimeException('YouTube API geçersiz yanıt verdi.');
    if (isset($decoded['error'])) {
        $message = (string)($decoded['error']['message'] ?? 'YouTube API isteği başarısız.');
        throw new RuntimeException($message);
    }
    return $decoded;
}

function iso_duration_seconds(string $value): ?int {
    if ($value === '') return null;
    try {
        $interval = new DateInterval($value);
        return ($interval->d * 86400) + ($interval->h * 3600) + ($interval->i * 60) + $interval->s;
    } catch (Throwable) {
        return null;
    }
}

function clock_duration_seconds(string $value): ?int {
    $parts = array_map('intval', explode(':', trim($value)));
    if (!$parts || count($parts) > 3) return null;
    $seconds = 0;
    foreach ($parts as $part) $seconds = ($seconds * 60) + $part;
    return $seconds;
}

function human_duration_seconds(string $value): ?int {
    $text = strtolower(trim($value));
    if ($text === '') return null;
    if (preg_match('/^(\d{1,2}:)?\d{1,2}:\d{2}$/', $text)) return clock_duration_seconds($text);
    $seconds = 0;
    $matched = false;
    if (preg_match('/(\d+)\s*(?:hours?|saat)/u', $text, $m)) { $seconds += ((int)$m[1]) * 3600; $matched = true; }
    if (preg_match('/(\d+)\s*(?:minutes?|dakika)/u', $text, $m)) { $seconds += ((int)$m[1]) * 60; $matched = true; }
    if (preg_match('/(\d+)\s*(?:seconds?|saniye)/u', $text, $m)) { $seconds += (int)$m[1]; $matched = true; }
    return $matched ? $seconds : null;
}

function relative_date(string $text): string {
    $value = strtolower(trim($text));
    if ($value === '') return '';
    $value = preg_replace('/^(streamed|premiered)\s+/', '', $value) ?? $value;
    if (preg_match('/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/', $value, $match)) {
        $count = max(1, (int)$match[1]);
        $unit = $match[2];
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        return $now->modify("-{$count} {$unit}s")->format('Y-m-d');
    }
    if (preg_match('/(\d+)\s+(dakika|saat|gün|hafta|ay|yıl)\s+önce/u', $value, $match)) {
        $count = max(1, (int)$match[1]);
        $units = ['dakika' => 'minutes', 'saat' => 'hours', 'gün' => 'days', 'hafta' => 'weeks', 'ay' => 'months', 'yıl' => 'years'];
        $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
        return $now->modify("-{$count} {$units[$match[2]]}")->format('Y-m-d');
    }
    if (str_contains($value, 'yesterday') || str_contains($value, 'dün')) {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->modify('-1 day')->format('Y-m-d');
    }
    $timestamp = strtotime($text);
    return $timestamp === false ? '' : gmdate('Y-m-d', $timestamp);
}

function clean_xml_text(string $value): string {
    return trim(html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_XML1, 'UTF-8'));
}

function text_node(mixed $node): string {
    if (is_string($node)) return trim($node);
    if (!is_array($node)) return '';
    if (isset($node['simpleText']) && is_string($node['simpleText'])) return trim($node['simpleText']);
    if (isset($node['content']) && is_string($node['content'])) return trim($node['content']);
    if (isset($node['runs']) && is_array($node['runs'])) {
        $parts = [];
        foreach ($node['runs'] as $run) if (is_array($run) && isset($run['text'])) $parts[] = (string)$run['text'];
        return trim(implode('', $parts));
    }
    return '';
}

function path_value(array $value, array $path): mixed {
    $cursor = $value;
    foreach ($path as $key) {
        if (!is_array($cursor) || !array_key_exists($key, $cursor)) return null;
        $cursor = $cursor[$key];
    }
    return $cursor;
}

function balanced_json_after(string $html, array $markers): ?array {
    foreach ($markers as $marker) {
        $offset = strpos($html, $marker);
        if ($offset === false) continue;
        $start = strpos($html, '{', $offset + strlen($marker));
        if ($start === false) continue;
        $depth = 0;
        $inString = false;
        $escaped = false;
        $length = strlen($html);
        for ($index = $start; $index < $length; $index++) {
            $char = $html[$index];
            if ($inString) {
                if ($escaped) { $escaped = false; continue; }
                if ($char === '\\') { $escaped = true; continue; }
                if ($char === '"') $inString = false;
                continue;
            }
            if ($char === '"') { $inString = true; continue; }
            if ($char === '{') $depth++;
            if ($char !== '}') continue;
            $depth--;
            if ($depth !== 0) continue;
            $decoded = json_decode(substr($html, $start, $index - $start + 1), true);
            if (is_array($decoded)) return $decoded;
            break;
        }
    }
    return null;
}

function find_first_key(mixed $node, string $wanted): mixed {
    if (!is_array($node)) return null;
    if (array_key_exists($wanted, $node)) return $node[$wanted];
    foreach ($node as $value) {
        $found = find_first_key($value, $wanted);
        if ($found !== null) return $found;
    }
    return null;
}

function find_web_url(mixed $node): string {
    if (!is_array($node)) return '';
    if (isset($node['webCommandMetadata']['url']) && is_string($node['webCommandMetadata']['url'])) {
        return $node['webCommandMetadata']['url'];
    }
    foreach ($node as $value) {
        $found = find_web_url($value);
        if ($found !== '') return $found;
    }
    return '';
}

function find_continuation_token(mixed $node): string {
    if (!is_array($node)) return '';
    $token = path_value($node, ['continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token']);
    if (is_string($token) && $token !== '') return $token;
    $token = path_value($node, ['continuationItemViewModel', 'continuationCommand', 'innertubeCommand', 'continuationCommand', 'token']);
    if (is_string($token) && $token !== '') return $token;
    $token = path_value($node, ['nextContinuationData', 'continuation']);
    if (is_string($token) && $token !== '') return $token;
    foreach ($node as $value) {
        $found = find_continuation_token($value);
        if ($found !== '') return $found;
    }
    return '';
}

function find_visitor_data(mixed $node): string {
    if (!is_array($node)) return '';
    if (isset($node['visitorData']) && is_string($node['visitorData']) && $node['visitorData'] !== '') return $node['visitorData'];
    foreach ($node as $value) {
        $found = find_visitor_data($value);
        if ($found !== '') return $found;
    }
    return '';
}

function thumbnail_from_sources(mixed $sources, string $videoId): string {
    if (is_array($sources) && $sources) {
        for ($index = count($sources) - 1; $index >= 0; $index--) {
            if (is_array($sources[$index]) && !empty($sources[$index]['url'])) return (string)$sources[$index]['url'];
        }
    }
    return "https://i.ytimg.com/vi/{$videoId}/hqdefault.jpg";
}

function renderer_video(array $renderer): ?array {
    $videoId = trim((string)($renderer['videoId'] ?? ''));
    if ($videoId === '') return null;
    $title = text_node($renderer['title'] ?? $renderer['headline'] ?? []);
    $durationText = text_node($renderer['lengthText'] ?? []);
    if ($durationText === '') {
        $overlay = find_first_key($renderer, 'thumbnailOverlayTimeStatusRenderer');
        if (is_array($overlay)) $durationText = text_node($overlay['text'] ?? []);
    }
    $publishedText = text_node($renderer['publishedTimeText'] ?? []);
    if ($publishedText === '') {
        $videoInfo = text_node($renderer['videoInfo'] ?? []);
        if (preg_match('/(?:(?:streamed|yayınlandı)\s+)?(?:\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago|\d+\s+(?:dakika|saat|gün|hafta|ay|yıl)\s+önce)/iu', $videoInfo, $m)) $publishedText = $m[0];
    }
    $navUrl = find_web_url($renderer['navigationEndpoint'] ?? $renderer);
    $encoded = json_encode($renderer, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
    $overlayStyle = (string)($overlay['style'] ?? '');
    $isLive = $overlayStyle === 'LIVE' || str_contains($encoded, 'BADGE_STYLE_TYPE_LIVE_NOW') || str_contains($encoded, 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE');
    $membersOnly = str_contains($encoded, 'BADGE_MEMBERS_ONLY') || stripos($encoded, 'Members only') !== false || str_contains($encoded, 'Üyelere özel');
    $isShort = str_contains($navUrl, '/shorts/') || $overlayStyle === 'SHORTS';
    $thumbnail = thumbnail_from_sources(path_value($renderer, ['thumbnail', 'thumbnails']), $videoId);
    return [
        'videoId' => $videoId,
        'title' => $title !== '' ? $title : $videoId,
        'thumbnailUrl' => $thumbnail,
        'publishedAt' => relative_date($publishedText),
        'publishedText' => $publishedText,
        'durationSeconds' => human_duration_seconds($durationText),
        'durationText' => $durationText,
        'isShort' => $isShort,
        'isLive' => $isLive,
        'membersOnly' => $membersOnly,
        'url' => $isShort ? "https://www.youtube.com/shorts/{$videoId}" : "https://www.youtube.com/watch?v={$videoId}",
    ];
}

function lockup_duration(array $viewModel): array {
    $overlay = find_first_key($viewModel, 'thumbnailBadgeViewModel');
    if (is_array($overlay)) {
        $text = text_node($overlay['text'] ?? []);
        $seconds = human_duration_seconds($text);
        if ($seconds !== null) return [$seconds, $text];
    }
    $label = (string)(path_value($viewModel, ['rendererContext', 'accessibilityContext', 'label']) ?? '');
    $seconds = human_duration_seconds($label);
    return [$seconds, $seconds !== null ? preg_replace('/^.*?(?=(?:\d+\s+(?:hours?|minutes?|seconds?|saat|dakika|saniye))[^\d]*$)/iu', '', $label) ?: '' : ''];
}

function lockup_published_text(array $viewModel): string {
    $rows = path_value($viewModel, ['metadata', 'lockupMetadataViewModel', 'metadata', 'contentMetadataViewModel', 'metadataRows']);
    if (!is_array($rows)) return '';
    foreach ($rows as $row) {
        if (!is_array($row) || !is_array($row['metadataParts'] ?? null)) continue;
        foreach ($row['metadataParts'] as $part) {
            $text = is_array($part) ? text_node($part['text'] ?? []) : '';
            if ($text !== '' && preg_match('/(?:(?:streamed|premiered|yayınlandı)\s+)?(?:\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago|yesterday|\d+\s+(?:dakika|saat|gün|hafta|ay|yıl)\s+önce|dün)/iu', $text, $m)) return $m[0];
        }
    }
    return '';
}

function lockup_video(array $viewModel): ?array {
    if (($viewModel['contentType'] ?? '') !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
    $videoId = trim((string)($viewModel['contentId'] ?? ''));
    if ($videoId === '') return null;
    $title = (string)(path_value($viewModel, ['metadata', 'lockupMetadataViewModel', 'title', 'content']) ?? '');
    $sources = path_value($viewModel, ['contentImage', 'thumbnailViewModel', 'image', 'sources']);
    [$durationSeconds, $durationText] = lockup_duration($viewModel);
    $publishedText = lockup_published_text($viewModel);
    $navUrl = (string)(path_value($viewModel, ['rendererContext', 'commandContext', 'onTap', 'innertubeCommand', 'commandMetadata', 'webCommandMetadata', 'url']) ?? '');
    $encoded = json_encode($viewModel, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
    $isShort = str_contains($navUrl, '/shorts/');
    $isLive = str_contains($encoded, 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE') || str_contains($encoded, 'BADGE_STYLE_TYPE_LIVE_NOW');
    $membersOnly = str_contains($encoded, 'BADGE_MEMBERS_ONLY');
    return [
        'videoId' => $videoId,
        'title' => $title !== '' ? $title : $videoId,
        'thumbnailUrl' => thumbnail_from_sources($sources, $videoId),
        'publishedAt' => relative_date($publishedText),
        'publishedText' => $publishedText,
        'durationSeconds' => $durationSeconds,
        'durationText' => $durationText,
        'isShort' => $isShort,
        'isLive' => $isLive,
        'membersOnly' => $membersOnly,
        'url' => $isShort ? "https://www.youtube.com/shorts/{$videoId}" : "https://www.youtube.com/watch?v={$videoId}",
    ];
}

function collect_public_videos(mixed $node, array &$indexed): void {
    if (!is_array($node)) return;
    foreach (['videoRenderer', 'gridVideoRenderer'] as $key) {
        if (isset($node[$key]) && is_array($node[$key])) {
            $video = renderer_video($node[$key]);
            if ($video && !isset($indexed[$video['videoId']])) $indexed[$video['videoId']] = $video;
        }
    }
    if (isset($node['lockupViewModel']) && is_array($node['lockupViewModel'])) {
        $video = lockup_video($node['lockupViewModel']);
        if ($video && !isset($indexed[$video['videoId']])) $indexed[$video['videoId']] = $video;
    }
    foreach ($node as $value) collect_public_videos($value, $indexed);
}

function feed_video(string $videoId, string $title, string $published): array {
    return [
        'videoId' => $videoId,
        'title' => $title !== '' ? $title : $videoId,
        'thumbnailUrl' => "https://i.ytimg.com/vi/{$videoId}/hqdefault.jpg",
        'publishedAt' => $published !== '' ? substr($published, 0, 10) : '',
        'publishedText' => '',
        'durationSeconds' => null,
        'durationText' => '',
        'isShort' => false,
        'isLive' => false,
        'membersOnly' => false,
        'url' => "https://www.youtube.com/watch?v={$videoId}",
    ];
}

function parse_feed_with_simplexml(string $raw): array {
    if (!function_exists('simplexml_load_string')) return [];
    $xml = @simplexml_load_string($raw);
    if ($xml === false) return [];
    $videos = [];
    foreach ($xml->entry as $entry) {
        $yt = $entry->children('http://www.youtube.com/xml/schemas/2015');
        $videoId = trim((string)($yt->videoId ?? ''));
        if ($videoId === '') continue;
        $videos[$videoId] = feed_video($videoId, trim((string)$entry->title), trim((string)$entry->published));
    }
    return array_values($videos);
}

function parse_feed_with_regex(string $raw): array {
    if (!preg_match_all('~<entry>(.*?)</entry>~si', $raw, $entries)) return [];
    $videos = [];
    foreach ($entries[1] as $entry) {
        if (!preg_match('~<yt:videoId>([^<]+)</yt:videoId>~i', $entry, $idMatch)) continue;
        $videoId = trim($idMatch[1]);
        if ($videoId === '') continue;
        preg_match('~<title>(.*?)</title>~si', $entry, $titleMatch);
        preg_match('~<published>(.*?)</published>~si', $entry, $publishedMatch);
        $videos[$videoId] = feed_video($videoId, clean_xml_text((string)($titleMatch[1] ?? '')), clean_xml_text((string)($publishedMatch[1] ?? '')));
    }
    return array_values($videos);
}

function fetch_public_feed(string $channelId): array {
    $raw = remote_get('https://www.youtube.com/feeds/videos.xml?channel_id=' . rawurlencode($channelId));
    $videos = parse_feed_with_simplexml($raw);
    if (!$videos) $videos = parse_feed_with_regex($raw);
    if (!$videos) throw new RuntimeException('YouTube RSS akışı video döndürmedi.');
    usort($videos, static fn($a, $b) => strcmp((string)$b['publishedAt'], (string)$a['publishedAt']));
    return $videos;
}

function extract_public_config(string $html): array {
    $ytcfg = balanced_json_after($html, ['ytcfg.set(', 'ytcfg.data_ =']);
    $apiKey = is_array($ytcfg) ? (string)($ytcfg['INNERTUBE_API_KEY'] ?? '') : '';
    $clientVersion = is_array($ytcfg) ? (string)($ytcfg['INNERTUBE_CONTEXT_CLIENT_VERSION'] ?? ($ytcfg['INNERTUBE_CONTEXT']['client']['clientVersion'] ?? '')) : '';
    $visitorData = is_array($ytcfg) ? (string)($ytcfg['VISITOR_DATA'] ?? ($ytcfg['INNERTUBE_CONTEXT']['client']['visitorData'] ?? '')) : '';
    if ($apiKey === '' && preg_match('/"INNERTUBE_API_KEY":"([^"]+)"/', $html, $m)) $apiKey = $m[1];
    if ($clientVersion === '' && preg_match('/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/', $html, $m)) $clientVersion = $m[1];
    if ($visitorData === '' && preg_match('/"VISITOR_DATA":"([^"]+)"/', $html, $m)) $visitorData = $m[1];
    return [$apiKey, $clientVersion, $visitorData];
}

function fetch_public_catalog(string $channelUrl, int $max): array {
    $html = remote_get(rtrim($channelUrl, '/') . '/videos?hl=tr&gl=TR');
    $initial = balanced_json_after($html, ['var ytInitialData =', 'ytInitialData =', 'window["ytInitialData"] =']);
    if (!$initial) throw new RuntimeException('YouTube kanal kataloğu başlangıç verisi çözülemedi.');
    [$apiKey, $clientVersion, $visitorData] = extract_public_config($html);
    if ($apiKey === '' || $clientVersion === '') throw new RuntimeException('YouTube public browse yapılandırması bulunamadı.');

    $indexed = [];
    collect_public_videos($initial, $indexed);
    $continuation = find_continuation_token($initial);
    $seen = [];
    $pageCount = 0;

    while ($continuation !== '' && count($indexed) < $max && $pageCount < 45) {
        if (isset($seen[$continuation])) break;
        $seen[$continuation] = true;
        $client = [
            'clientName' => 'WEB',
            'clientVersion' => $clientVersion,
            'hl' => 'tr',
            'gl' => 'TR',
        ];
        if ($visitorData !== '') $client['visitorData'] = $visitorData;
        $headers = [
            'X-YouTube-Client-Name: 1',
            'X-YouTube-Client-Version: ' . $clientVersion,
        ];
        if ($visitorData !== '') $headers[] = 'X-Goog-Visitor-Id: ' . $visitorData;
        $response = remote_post_json(
            'https://www.youtube.com/youtubei/v1/browse?key=' . rawurlencode($apiKey) . '&prettyPrint=false',
            ['context' => ['client' => $client], 'continuation' => $continuation],
            $headers,
        );
        collect_public_videos($response, $indexed);
        $nextVisitor = find_visitor_data($response);
        if ($nextVisitor !== '') $visitorData = $nextVisitor;
        $next = find_continuation_token($response);
        if ($next === $continuation) break;
        $continuation = $next;
        $pageCount++;
        if ($pageCount % 8 === 0) usleep(80000);
    }

    $videos = array_slice(array_values($indexed), 0, $max);
    if (!$videos) throw new RuntimeException('YouTube public browse video döndürmedi.');
    return [$videos, $continuation === '' || count($videos) < $max, $pageCount];
}

// Adı geriye dönük doğrulama sözleşmesi için korunuyor. Public mod önce kanalın
// browse devam sayfalarını tarar; RSS yalnız YouTube bu yapıyı değiştirdiğinde fallback olur.
function fetch_public_page(string $channelUrl, string $channelId, int $max): array {
    try {
        [$videos, $complete, $pages] = fetch_public_catalog($channelUrl, $max);
        return [$videos, $complete, 'youtube-public-catalog', $pages];
    } catch (Throwable $browseError) {
        error_log('[birdesengor-youtube-public] ' . $browseError->getMessage());
        $videos = fetch_public_feed($channelId);
        return [array_slice($videos, 0, min($max, 15)), false, 'youtube-feed-fallback', 0];
    }
}

function fetch_data_api(string $channelId, string $apiKey, int $max): array {
    $channel = api_json('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=' . rawurlencode($channelId) . '&key=' . rawurlencode($apiKey));
    $uploads = (string)($channel['items'][0]['contentDetails']['relatedPlaylists']['uploads'] ?? '');
    if ($uploads === '') throw new RuntimeException('YouTube yükleme oynatma listesi bulunamadı.');

    $ids = [];
    $pageToken = '';
    $complete = false;
    while (count($ids) < $max) {
        $url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=' . rawurlencode($uploads) . '&key=' . rawurlencode($apiKey);
        if ($pageToken !== '') $url .= '&pageToken=' . rawurlencode($pageToken);
        $page = api_json($url);
        foreach ($page['items'] ?? [] as $item) {
            $id = trim((string)($item['contentDetails']['videoId'] ?? ''));
            if ($id !== '') $ids[] = $id;
            if (count($ids) >= $max) break;
        }
        $pageToken = (string)($page['nextPageToken'] ?? '');
        if ($pageToken === '') { $complete = true; break; }
    }

    $videos = [];
    foreach (array_chunk($ids, 50) as $chunk) {
        $detail = api_json('https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,liveStreamingDetails&id=' . rawurlencode(implode(',', $chunk)) . '&key=' . rawurlencode($apiKey));
        foreach ($detail['items'] ?? [] as $item) {
            $id = (string)($item['id'] ?? '');
            if ($id === '') continue;
            $snippet = is_array($item['snippet'] ?? null) ? $item['snippet'] : [];
            $content = is_array($item['contentDetails'] ?? null) ? $item['contentDetails'] : [];
            $seconds = iso_duration_seconds((string)($content['duration'] ?? ''));
            $thumbs = is_array($snippet['thumbnails'] ?? null) ? $snippet['thumbnails'] : [];
            $thumbnail = (string)($thumbs['high']['url'] ?? $thumbs['medium']['url'] ?? $thumbs['default']['url'] ?? "https://i.ytimg.com/vi/{$id}/hqdefault.jpg");
            $published = (string)($snippet['publishedAt'] ?? '');
            $isLive = ((string)($snippet['liveBroadcastContent'] ?? 'none')) !== 'none' || isset($item['liveStreamingDetails']);
            $videos[] = [
                'videoId' => $id,
                'title' => (string)($snippet['title'] ?? $id),
                'thumbnailUrl' => $thumbnail,
                'publishedAt' => $published !== '' ? substr($published, 0, 10) : '',
                'publishedText' => '',
                'durationSeconds' => $seconds,
                'durationText' => '',
                'isShort' => false,
                'isLive' => $isLive,
                'membersOnly' => false,
                'url' => "https://www.youtube.com/watch?v={$id}",
            ];
        }
    }
    return [$videos, $complete];
}

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        header('Allow: GET');
        respond(['ok' => false, 'message' => 'Yalnız GET destekleniyor.'], 405);
    }

    $max = max(10, min(600, (int)($_GET['max'] ?? 300)));
    $channelUrl = channel_url();
    $channelId = extract_channel_id($channelUrl);
    $apiKey = trim((string)getenv('BIRDESENGOR_YOUTUBE_API_KEY'));

    // v3: public browse ile genişletilmiş katalog; eski 15 kayıtlık RSS cache'i taşınmaz.
    $cacheKey = hash('sha256', 'v4-tr|' . $channelId . '|' . ($apiKey !== '' ? 'api' : 'public-browse') . '|' . $max);
    $cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'birdesengor-youtube-' . $cacheKey . '.json';
    if (is_file($cacheFile) && (time() - (int)filemtime($cacheFile)) < 600) {
        $cached = json_decode((string)file_get_contents($cacheFile), true);
        if (is_array($cached) && !empty($cached['videos'])) respond($cached);
    }

    $mode = 'youtube-data-api';
    $complete = false;
    $pages = 0;
    if ($apiKey !== '') {
        try {
            [$videos, $complete] = fetch_data_api($channelId, $apiKey, $max);
        } catch (Throwable $apiError) {
            error_log('[birdesengor-youtube-api] ' . $apiError->getMessage());
            [$videos, $complete, $mode, $pages] = fetch_public_page($channelUrl, $channelId, $max);
        }
    } else {
        [$videos, $complete, $mode, $pages] = fetch_public_page($channelUrl, $channelId, $max);
    }

    if (!$videos) throw new RuntimeException('YouTube kataloğu boş döndü.');
    $payload = [
        'ok' => true,
        'channelUrl' => $channelUrl,
        'channelId' => $channelId,
        'mode' => $mode,
        'complete' => $complete,
        'count' => count($videos),
        'pagesScanned' => $pages,
        'fetchedAt' => gmdate('c'),
        'videos' => $videos,
    ];
    @file_put_contents($cacheFile, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    respond($payload);
} catch (Throwable $error) {
    error_log('[birdesengor-youtube] ' . $error->getMessage());
    fail_response('YouTube video kataloğu şu anda alınamadı.');
}
