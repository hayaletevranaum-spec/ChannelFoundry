const NAMED_CATEGORY_TO_KIND = new Map([
  ["character", "character"],
  ["location", "location"],
  ["object", "object"],
]);

function clean(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function normalizeName(value) {
  return clean(value, 500)
    .toLocaleLowerCase("tr-TR")
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));
}

function textArray(value, limit = 80, max = 800) {
  const result = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const text = clean(typeof raw === "string" ? raw : raw?.text, max);
    if (!text || result.some((entry) => normalizeName(entry) === normalizeName(text))) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function entityCatalog(db) {
  if (!tableExists(db, "universe_workspace_nodes")) return [];
  return db.prepare(`
    SELECT key, kind, name, aliases_json AS aliasesJson, payload_json AS payloadJson, state
    FROM universe_workspace_nodes
    WHERE kind IN ('character','location','object')
    ORDER BY CASE state WHEN 'approved' THEN 0 ELSE 1 END, kind, name
  `).all().map((row) => ({
    key: String(row.key),
    kind: String(row.kind),
    name: clean(row.name, 260),
    aliases: textArray(safeJson(row.aliasesJson, []), 30, 260),
    payload: safeJson(row.payloadJson, {}),
    state: row.state === "approved" ? "approved" : "draft",
  })).filter((entry) => entry.name);
}

function incomingDetails(item) {
  const payload = item?.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload : {};
  const values = [];
  if (item?.category === "character" && clean(payload.role, 500)) values.push(clean(payload.role, 500));
  values.push(...textArray(payload.details, 40, 800));
  return textArray(values, 50, 800);
}

function knownDetails(entity) {
  const payload = entity?.payload && typeof entity.payload === "object" && !Array.isArray(entity.payload) ? entity.payload : {};
  return textArray([
    clean(payload.summary, 3000),
    clean(payload.role, 500),
    ...(Array.isArray(payload.roles) ? payload.roles : []),
    ...(Array.isArray(payload.details) ? payload.details : []),
  ], 160, 3000);
}

function hasNewInformation(item, entity) {
  const incoming = incomingDetails(item);
  if (!incoming.length) return false;
  const known = new Set(knownDetails(entity).map(normalizeName).filter(Boolean));
  return incoming.some((detail) => !known.has(normalizeName(detail)));
}

function candidatesForItem(catalog, item) {
  const kind = NAMED_CATEGORY_TO_KIND.get(String(item?.category ?? ""));
  if (!kind) return { kind: "", exact: [], aliases: [] };
  const wanted = normalizeName(item?.label);
  if (!wanted) return { kind, exact: [], aliases: [] };
  const sameKind = catalog.filter((entry) => entry.kind === kind);
  const exact = sameKind.filter((entry) => normalizeName(entry.name) === wanted);
  if (exact.length) return { kind, exact, aliases: [] };
  const aliases = sameKind.filter((entry) => entry.aliases.some((alias) => normalizeName(alias) === wanted));
  return { kind, exact: [], aliases };
}

function publicCandidate(entry) {
  return {
    key: entry.key,
    kind: entry.kind,
    name: entry.name,
    aliases: entry.aliases,
    state: entry.state,
  };
}

function resolveItem(catalog, item) {
  const lookup = candidatesForItem(catalog, item);
  if (!lookup.kind) return null;
  const matches = lookup.exact.length ? lookup.exact : lookup.aliases;
  if (!matches.length) {
    const hasDetail = incomingDetails(item).length > 0;
    return {
      status: "new",
      kind: lookup.kind,
      matchedBy: "",
      canonicalName: "",
      candidates: [],
      recommendedDecision: "include",
      needsReview: !hasDetail,
      reason: hasDetail
        ? "Evren'de eşleşen kayıt yok; yeni kayıt olarak aktarılabilir."
        : "Evren'de eşleşen kayıt yok ve ek ayrıntı sınırlı; yeni kayıt kararını gözden geçir.",
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      kind: lookup.kind,
      matchedBy: lookup.exact.length ? "name" : "alias",
      canonicalName: "",
      candidates: matches.map(publicCandidate),
      recommendedDecision: "context",
      needsReview: true,
      reason: "Bu ad birden fazla mevcut kayda uyuyor; doğru kayıt seçilmeden yeni kayıt oluşturma.",
    };
  }
  const match = matches[0];
  const contributes = hasNewInformation(item, match);
  return {
    status: "existing",
    kind: lookup.kind,
    matchedBy: lookup.exact.length ? "name" : "alias",
    canonicalName: match.name,
    candidates: [publicCandidate(match)],
    recommendedDecision: contributes ? "include" : "context",
    needsReview: false,
    reason: contributes
      ? `Evren'deki “${match.name}” kaydına yeni ayrıntı ekliyor.`
      : `Evren'deki “${match.name}” kaydı yalnız bağlam olarak tekrar geçiyor.`,
  };
}

function decoratePackage(db, pack, review) {
  const catalog = entityCatalog(db);
  const decisions = review?.decisions && typeof review.decisions === "object" && !Array.isArray(review.decisions) ? review.decisions : {};
  const overrides = review?.nameOverrides && typeof review.nameOverrides === "object" && !Array.isArray(review.nameOverrides) ? review.nameOverrides : {};
  const items = (pack?.items ?? []).map((item) => {
    const resolution = resolveItem(catalog, item);
    if (!resolution) return item;
    const explicitDecision = Object.prototype.hasOwnProperty.call(decisions, item.key);
    const explicitOverride = Object.prototype.hasOwnProperty.call(overrides, item.key);
    const canonicalOverride = resolution.status === "existing"
      && resolution.canonicalName
      && normalizeName(resolution.canonicalName) !== normalizeName(item.label)
      ? resolution.canonicalName
      : "";
    return {
      ...item,
      decision: explicitDecision ? item.decision : resolution.recommendedDecision,
      nameOverride: explicitOverride ? item.nameOverride : (canonicalOverride || item.nameOverride || ""),
      resolution,
    };
  });
  return {
    ...pack,
    items,
    entityCatalog: catalog.map(publicCandidate),
  };
}

module.exports = {
  decoratePackage,
  entityCatalog,
  hasNewInformation,
  normalizeName,
  resolveItem,
};
