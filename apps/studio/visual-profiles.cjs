const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const dataRootByDatabase = new WeakMap();

function rememberDataRoot(db, userDataPath) {
  const value = String(userDataPath ?? "").trim();
  if (!db || !value) return;
  dataRootByDatabase.set(db, path.resolve(value));
}

function defaultStudioDataRoot() {
  const projectRoot = path.resolve(__dirname, "../..");
  const configured = String(process.env.CHANNEL_FOUNDRY_DATA_ROOT ?? "").trim();
  const root = configured
    ? path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(projectRoot, configured)
    : path.join(projectRoot, "local-data");
  return path.join(root, "studio");
}

function dataRoot(db) {
  return dataRootByDatabase.get(db) ?? defaultStudioDataRoot();
}

function portablePath(value) {
  return String(value ?? "").split(path.sep).join("/");
}

function nativeRelativePath(value) {
  return String(value ?? "").replace(/[\\/]+/g, path.sep);
}

function resolveStoredImagePath(db, storedPath) {
  const raw = String(storedPath ?? "").trim();
  if (!raw) return "";

  if (path.isAbsolute(raw)) {
    if (fs.existsSync(raw)) return raw;
    const fallback = path.join(dataRoot(db), "visual-assets", path.basename(raw));
    return fs.existsSync(fallback) ? fallback : raw;
  }

  const root = dataRoot(db);
  const candidate = path.resolve(root, nativeRelativePath(raw));
  if (fs.existsSync(candidate)) return candidate;
  const fallback = path.join(root, "visual-assets", path.basename(raw));
  return fs.existsSync(fallback) ? fallback : candidate;
}

function storedImagePath(db, file) {
  const value = String(file ?? "").trim();
  if (!value) return "";
  const root = dataRoot(db);
  if (!path.isAbsolute(value)) return portablePath(value);
  const relative = path.relative(root, value);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return value;
  return portablePath(relative);
}

function ensureSchema(db, userDataPath = "") {
  rememberDataRoot(db, userDataPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_visual_profiles (
      entity_key TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      description TEXT NOT NULL DEFAULT '',
      attributes_json TEXT NOT NULL DEFAULT '[]',
      atmosphere TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      negative_prompt TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      image_source TEXT NOT NULL DEFAULT '',
      image_provider TEXT NOT NULL DEFAULT '',
      image_model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);
}

function safeArray(value) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeAttributes(value) {
  const source = Array.isArray(value) ? value : [];
  const result = [];
  for (const entry of source) {
    const text = String(entry ?? "").trim().slice(0, 400);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= 24) break;
  }
  return result;
}

function sanitizeEntityKey(value) {
  const key = String(value ?? "").trim();
  if (!key || key.length > 700) throw new Error("Görsel profili için geçerli bir varlık anahtarı gerekli.");
  return key;
}

function imageDataUrl(file) {
  if (!file || !fs.existsSync(file)) return "";
  const extension = path.extname(file).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) return "";
  const buffer = fs.readFileSync(file);
  if (buffer.length > 12 * 1024 * 1024) return "";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function rowToProfile(db, row, includeImageData = true) {
  if (!row) return null;
  const imagePath = resolveStoredImagePath(db, row.imagePath);
  return {
    entityKey: String(row.entityKey ?? ""),
    entityType: String(row.entityType ?? ""),
    source: String(row.source ?? "manual"),
    description: String(row.description ?? ""),
    attributes: safeArray(row.attributesJson),
    atmosphere: String(row.atmosphere ?? ""),
    prompt: String(row.prompt ?? ""),
    negativePrompt: String(row.negativePrompt ?? ""),
    imagePath,
    imageSource: String(row.imageSource ?? ""),
    imageProvider: String(row.imageProvider ?? ""),
    imageModel: String(row.imageModel ?? ""),
    imageDataUrl: includeImageData ? imageDataUrl(imagePath) : "",
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function profileRow(db, entityKey) {
  ensureSchema(db);
  const key = sanitizeEntityKey(entityKey);
  return db.prepare(`
    SELECT entity_key AS entityKey, entity_type AS entityType, source,
           description, attributes_json AS attributesJson, atmosphere,
           prompt, negative_prompt AS negativePrompt,
           image_path AS imagePath, image_source AS imageSource,
           image_provider AS imageProvider, image_model AS imageModel,
           updated_at AS updatedAt
    FROM entity_visual_profiles
    WHERE entity_key = ?
  `).get(key);
}

function get(db, entityKey) {
  return rowToProfile(db, profileRow(db, entityKey), true);
}

function getMetadata(db, entityKey) {
  return rowToProfile(db, profileRow(db, entityKey), false);
}

function save(db, input) {
  ensureSchema(db);
  const key = sanitizeEntityKey(input?.entityKey);
  const currentRow = profileRow(db, key);
  const current = rowToProfile(db, currentRow, false);
  const entityType = String(input?.entityType ?? current?.entityType ?? "").trim().slice(0, 80);
  const source = String(input?.source ?? current?.source ?? "manual").trim().slice(0, 40) || "manual";
  const description = String(input?.description ?? current?.description ?? "").trim().slice(0, 6000);
  const attributes = normalizeAttributes(input?.attributes ?? current?.attributes ?? []);
  const atmosphere = String(input?.atmosphere ?? current?.atmosphere ?? "").trim().slice(0, 1200);
  const prompt = String(input?.prompt ?? current?.prompt ?? "").trim().slice(0, 12000);
  const negativePrompt = String(input?.negativePrompt ?? current?.negativePrompt ?? "").trim().slice(0, 6000);
  db.prepare(`
    INSERT INTO entity_visual_profiles (
      entity_key, entity_type, source, description, attributes_json,
      atmosphere, prompt, negative_prompt, image_path, image_source,
      image_provider, image_model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_key) DO UPDATE SET
      entity_type = excluded.entity_type,
      source = excluded.source,
      description = excluded.description,
      attributes_json = excluded.attributes_json,
      atmosphere = excluded.atmosphere,
      prompt = excluded.prompt,
      negative_prompt = excluded.negative_prompt,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    key,
    entityType,
    source,
    description,
    JSON.stringify(attributes),
    atmosphere,
    prompt,
    negativePrompt,
    currentRow?.imagePath ?? "",
    currentRow?.imageSource ?? "",
    currentRow?.imageProvider ?? "",
    currentRow?.imageModel ?? "",
  );
  return get(db, key);
}

function assetDirectory(userDataPath) {
  const directory = path.join(userDataPath, "visual-assets");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function targetFile(userDataPath, entityKey, extension) {
  const token = crypto.createHash("sha256").update(`${entityKey}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 24);
  return path.join(assetDirectory(userDataPath), `${token}${extension}`);
}

function attachFile(db, userDataPath, input) {
  rememberDataRoot(db, userDataPath);
  ensureSchema(db);
  const key = sanitizeEntityKey(input?.entityKey);
  const sourceFile = String(input?.file ?? "").trim();
  if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error("Eklenecek görsel dosyası bulunamadı.");
  const extension = path.extname(sourceFile).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("Yalnız PNG, JPG/JPEG ve WebP görseller eklenebilir.");
  const stat = fs.statSync(sourceFile);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("Görsel dosyası geçersiz veya 25 MB sınırını aşıyor.");
  const destination = targetFile(userDataPath, key, extension === ".jpeg" ? ".jpg" : extension);
  fs.copyFileSync(sourceFile, destination);
  return attachStoredFile(db, key, {
    entityType: input?.entityType,
    file: destination,
    source: "manual",
    provider: "",
    model: "",
  });
}

function attachStoredFile(db, entityKey, input) {
  ensureSchema(db);
  const key = sanitizeEntityKey(entityKey);
  const file = String(input?.file ?? "").trim();
  if (!file || !fs.existsSync(file)) throw new Error("Görsel dosyası bulunamadı.");
  const extension = path.extname(file).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("Üretilen görsel desteklenen bir dosya biçiminde değil.");
  const existing = getMetadata(db, key) ?? save(db, { entityKey: key, entityType: input?.entityType ?? "", source: "manual" });
  if (existing.imagePath && existing.imagePath !== file && existing.imagePath.includes(`${path.sep}visual-assets${path.sep}`)) {
    try { fs.unlinkSync(existing.imagePath); } catch {}
  }
  db.prepare(`
    UPDATE entity_visual_profiles
    SET entity_type = CASE WHEN ? <> '' THEN ? ELSE entity_type END,
        image_path = ?, image_source = ?, image_provider = ?, image_model = ?, updated_at = CURRENT_TIMESTAMP
    WHERE entity_key = ?
  `).run(
    String(input?.entityType ?? "").trim(),
    String(input?.entityType ?? "").trim(),
    storedImagePath(db, file),
    String(input?.source ?? "manual").trim().slice(0, 40),
    String(input?.provider ?? "").trim().slice(0, 120),
    String(input?.model ?? "").trim().slice(0, 240),
    key,
  );
  return get(db, key);
}

function clearImage(db, entityKey) {
  ensureSchema(db);
  const key = sanitizeEntityKey(entityKey);
  const existing = getMetadata(db, key);
  if (!existing) return { cleared: false, entityKey: key };
  if (existing.imagePath && existing.imagePath.includes(`${path.sep}visual-assets${path.sep}`)) {
    try { fs.unlinkSync(existing.imagePath); } catch {}
  }
  db.prepare(`
    UPDATE entity_visual_profiles
    SET image_path = '', image_source = '', image_provider = '', image_model = '', updated_at = CURRENT_TIMESTAMP
    WHERE entity_key = ?
  `).run(key);
  return { cleared: true, entityKey: key, profile: get(db, key) };
}

module.exports = {
  ensureSchema,
  get,
  getMetadata,
  save,
  attachFile,
  attachStoredFile,
  clearImage,
  assetDirectory,
  targetFile,
};
