function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(String(name)));
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_transcripts (
      content_key TEXT PRIMARY KEY REFERENCES content_items(key) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('youtube', 'manual')),
      language TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_transcripts (
      provider TEXT NOT NULL CHECK (provider IN ('youtube')),
      external_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('youtube', 'manual')),
      language TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, external_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_content_transcripts_source ON content_transcripts(source, language);
    CREATE INDEX IF NOT EXISTS idx_source_transcripts_source ON source_transcripts(provider, source, language);
  `);

  // Retain old content-level rows while copying them into the source archive.
  if (tableExists(db, "content_sources")) {
    db.exec(`
      INSERT INTO source_transcripts (provider, external_id, source, language, text, created_at, updated_at)
      SELECT 'youtube', cs.external_id, ct.source, ct.language, ct.text, ct.created_at, ct.updated_at
      FROM content_transcripts ct
      JOIN content_sources cs ON cs.content_key = ct.content_key AND cs.provider = 'youtube'
      ON CONFLICT(provider, external_id) DO NOTHING;
    `);
  }
}

function normalizeText(value) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("Transkript metni boş olamaz.");
  if (text.length > 1_500_000) throw new Error("Transkript çok büyük. En fazla 1.5 milyon karakter saklanabilir.");
  return text;
}

function transcriptStats(text) {
  const normalized = String(text ?? "").trim();
  return {
    characterCount: normalized.length,
    wordCount: normalized ? normalized.split(/\s+/u).filter(Boolean).length : 0,
  };
}

function rowToTranscript(row, identifier = "") {
  if (!row) return null;
  const text = String(row.text ?? "");
  return {
    contentKey: String(row.contentKey ?? identifier),
    ...(row.videoId ? { videoId: String(row.videoId) } : {}),
    source: row.source === "youtube" ? "youtube" : "manual",
    language: String(row.language ?? ""),
    text,
    updatedAt: String(row.updatedAt ?? ""),
    ...transcriptStats(text),
  };
}

function getSourceTranscript(db, videoId) {
  ensureSchema(db);
  const id = String(videoId ?? "").trim();
  if (!id) throw new Error("Video kimliği gerekli.");
  const row = db.prepare(`
    SELECT external_id AS videoId, source, language, text, updated_at AS updatedAt
    FROM source_transcripts WHERE provider = 'youtube' AND external_id = ?
  `).get(id);
  if (!row) return null;
  let contentKey = id;
  if (tableExists(db, "content_sources")) {
    contentKey = db.prepare(`
      SELECT content_key AS contentKey FROM content_sources
      WHERE provider = 'youtube' AND external_id = ?
    `).get(id)?.contentKey ?? id;
  }
  return rowToTranscript({ ...row, contentKey }, id);
}

function getTranscript(db, identifier) {
  ensureSchema(db);
  const key = String(identifier ?? "").trim();
  if (!key) throw new Error("İçerik anahtarı veya video kimliği gerekli.");
  if (tableExists(db, "content_sources")) {
    const source = db.prepare(`
      SELECT external_id AS videoId FROM content_sources
      WHERE content_key = ? AND provider = 'youtube'
    `).get(key);
    if (source?.videoId) {
      const sourceTranscript = getSourceTranscript(db, source.videoId);
      if (sourceTranscript) return { ...sourceTranscript, contentKey: key };
    }
  }
  const row = db.prepare(`
    SELECT content_key AS contentKey, source, language, text, updated_at AS updatedAt
    FROM content_transcripts WHERE content_key = ?
  `).get(key);
  if (row) return rowToTranscript(row, key);
  return getSourceTranscript(db, key);
}

function saveTranscript(db, input) {
  ensureSchema(db);
  const contentKey = String(input?.contentKey ?? "").trim();
  if (!contentKey) throw new Error("İçerik anahtarı gerekli.");
  const exists = db.prepare("SELECT 1 AS ok FROM content_items WHERE key = ?").get(contentKey);
  if (!exists) throw new Error("Transkriptin bağlanacağı içerik bulunamadı.");
  const source = input?.source === "youtube" ? "youtube" : "manual";
  const language = String(input?.language ?? "").trim().slice(0, 32);
  const text = normalizeText(input?.text);
  db.prepare(`
    INSERT INTO content_transcripts (content_key, source, language, text)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(content_key) DO UPDATE SET source=excluded.source, language=excluded.language,
      text=excluded.text, updated_at=CURRENT_TIMESTAMP
  `).run(contentKey, source, language, text);
  return getTranscript(db, contentKey);
}

function saveSourceTranscript(db, input) {
  ensureSchema(db);
  const videoId = String(input?.videoId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Geçerli bir YouTube video kimliği gerekli.");
  const source = input?.source === "manual" ? "manual" : "youtube";
  const language = String(input?.language ?? "").trim().slice(0, 32);
  const text = normalizeText(input?.text);
  db.prepare(`
    INSERT INTO source_transcripts (provider, external_id, source, language, text)
    VALUES ('youtube', ?, ?, ?, ?)
    ON CONFLICT(provider, external_id) DO UPDATE SET source=excluded.source, language=excluded.language,
      text=excluded.text, updated_at=CURRENT_TIMESTAMP
  `).run(videoId, source, language, text);
  return getSourceTranscript(db, videoId);
}

function deleteTranscript(db, identifier) {
  ensureSchema(db);
  const key = String(identifier ?? "").trim();
  if (!key) throw new Error("Silinecek transkript anahtarı gerekli.");
  let deleted = Number(db.prepare("DELETE FROM content_transcripts WHERE content_key = ?").run(key).changes);
  let videoId = /^[A-Za-z0-9_-]{11}$/.test(key) ? key : "";
  if (!videoId && tableExists(db, "content_sources")) {
    videoId = db.prepare("SELECT external_id AS videoId FROM content_sources WHERE provider = 'youtube' AND content_key = ?").get(key)?.videoId ?? "";
  }
  if (videoId) deleted += Number(db.prepare("DELETE FROM source_transcripts WHERE provider = 'youtube' AND external_id = ?").run(videoId).changes);
  return { deleted: deleted > 0, contentKey: key };
}

module.exports = {
  deleteTranscript, ensureSchema, getSourceTranscript, getTranscript, saveSourceTranscript,
  saveTranscript, tableExists, transcriptStats,
};
