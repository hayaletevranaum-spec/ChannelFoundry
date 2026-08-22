const fs = require("node:fs");
const path = require("node:path");
const { isCliProvider, normalizeEndpoint, normalizeProvider, normalizeTimeoutSeconds } = require("./ai-config.cjs");
const aiJson = require("./ai-json.cjs");
const aiActivity = require("./ai-activity.cjs");
const { requestTextCompletion } = require("./ai-client.cjs");
const { universeKindOutputSchema } = require("./ai-output-schemas.cjs");
const { cleanText, collectVideoIds, normalizeUniverse } = require("./universe-normalizer.cjs");

const OUTPUT_MAX_TOKENS = 12000;
const KIND_DEFINITIONS = [
  {
    key: "stories",
    label: "hikâyeler",
    schema: "{name,aliases,summary,sourceVideoIds,sequence:[{text,sourceVideoIds}],characterNames,locationNames,objectNames,visual:{description,attributes,atmosphere,prompt,negativePrompt}}",
    instruction: "Her kaynak videoyu en az bir hikâyenin sourceVideoIds alanında koru. Bağımsız anlatıları zorla birleştirme.",
  },
  {
    key: "characters",
    label: "karakterler",
    schema: "{name,aliases,summary,roles,details:[{text,sourceVideoIds}],storyNames,sourceVideoIds,visual:{description,attributes,atmosphere,prompt,negativePrompt}}",
    instruction: "Aynı karakterin açık isim ve lakap varyantlarını birleştir; belirsiz kişileri zorla birleştirme.",
  },
  {
    key: "events",
    label: "olaylar",
    schema: "{name,summary,sourceVideoIds,storyNames,characterNames,locationNames,visual:{description,attributes,atmosphere,prompt,negativePrompt}}",
    instruction: "Yalnız önemli olay ve sahne düğümlerini koru; aynı olayın tekrarlarını birleştir.",
  },
  {
    key: "locations",
    label: "mekânlar",
    schema: "{name,aliases,summary,details:[{text,sourceVideoIds}],storyNames,sourceVideoIds,visual:{description,attributes,atmosphere,prompt,negativePrompt}}",
    instruction: "Mekân adlarını ve açık ad varyantlarını koru; fiziksel ayrıntı uydurma.",
  },
  {
    key: "objects",
    label: "nesneler",
    schema: "{name,aliases,summary,details:[{text,sourceVideoIds}],storyNames,sourceVideoIds,visual:{description,attributes,atmosphere,prompt,negativePrompt}}",
    instruction: "Önemli nesne ve sembolleri, kaynak bağlarını kaybetmeden birleştir.",
  },
];

function privateConfig(userDataPath) {
  const file = path.join(userDataPath, "ai-config.json");
  if (!fs.existsSync(file)) throw new Error("Evren birleştirme için önce AI modeli yapılandırılmalı.");
  let config;
  try { config = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("AI ayar dosyası okunamadı."); }
  const provider = normalizeProvider(config?.provider);
  const cliProvider = isCliProvider(provider);
  const endpoint = cliProvider ? "" : normalizeEndpoint(config?.endpoint, provider);
  const model = cleanText(config?.model, 240);
  if (!model && !cliProvider) throw new Error("Evren birleştirme için AI model adı gerekli.");
  const requestedFallbackModel = cleanText(config?.fallbackModel, 240);
  const fallbackModel = !cliProvider && requestedFallbackModel && requestedFallbackModel !== model ? requestedFallbackModel : "";
  const timeoutSeconds = normalizeTimeoutSeconds(config?.timeoutSeconds, 420);
  return {
    provider,
    endpoint,
    model,
    displayModel: model || "Codex CLI · varsayılan",
    fallbackModel,
    apiKey: cliProvider ? "" : cleanText(config?.apiKey, 1000),
    timeoutSeconds,
  };
}

async function requestCompletion(config, messages, outputSchema, maxTokens = OUTPUT_MAX_TOKENS, signal, activity) {
  return requestTextCompletion(config, messages, {
    temperature: 0.05,
    maxTokens,
    json: true,
    outputSchema,
    signal,
    activity,
  });
}

function repairMessages(raw) {
  return [
    {
      role: "system",
      content: [
        "JSON onarım aracısın.",
        "Kullanıcı sana başka bir modelin bozuk veya açıklama eklenmiş JSON çıktısını verecek.",
        "Kesilmiş içeriği tamamlama, yeni ayrıntı veya sourceVideoIds değeri üretme.",
        "Yalnız sözdizimi hatalarını düzelt; veri alanlarını ve items dizisini koru.",
        "Markdown, code fence veya açıklama yazma. Yalnız tek bir geçerli JSON nesnesi döndür.",
      ].join(" "),
    },
    { role: "user", content: raw },
  ];
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function looksTruncated(response) {
  const reason = String(response?.finishReason ?? "").toLowerCase();
  if (/length|max(?:imum)?[_ -]?(?:output[_ -]?)?tokens?/.test(reason)) return true;
  const content = aiJson.stripCodeFences(response?.content ?? "").trim();
  if (!/^[{[]/.test(content)) return false;
  return !/[}\]]$/.test(content);
}

function assertCompleteResponse(userDataPath, label, response) {
  if (!looksTruncated(response)) return;
  aiJson.writeDebug(userDataPath, label, {
    outcome: "truncated",
    finishReason: response.finishReason,
    rawResponse: response.content,
  });
  throw codedError("AI_OUTPUT_TRUNCATED", `AI, ${label} çıktısını token sınırında kesti.`);
}

function kindMessages(input, level, definition) {
  return [
    {
      role: "system",
      content: [
        "Channel Foundry kanalının anlatı evrenini birleştiren editoryal AI'sın.",
        "Doğru/yanlış veya güvenilirlik değerlendirmesi yapmadan yalnız verilen kanal anlatısını yapılandır.",
        `HEDEF DİZİ: ${definition.key}. Bu çağrıda yalnız ${definition.label} üretilir; başka evren dizileri üretme.`,
        level === 0
          ? "Girdideki videos kayıtlarından hedef türü çıkar ve aynı kayıtları birleştir."
          : "Girdideki partials kayıtlarının yalnız hedef türünü kayıpsız ve tekrarsız birleştir.",
        "Her bilgi için sourceVideoIds bağını eksiksiz koru; yalnız girdideki kimlikleri kullan.",
        definition.instruction,
        "Özetleri ve görsel metinlerini tekrarsız ve özlü tut. JSON'u gereksiz boşluk ve satır sonu olmadan yaz.",
        `Şema tam olarak {"items":[${definition.schema}]}. items alanını boş olsa bile mutlaka yaz.`,
        "Markdown, code fence, giriş veya sonuç cümlesi yazma. Yalnız tek bir JSON nesnesi döndür.",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(input) },
  ];
}

function videoHasKind(video, key) {
  if (key === "stories") return Boolean(video?.videoId);
  if (key === "characters") return Array.isArray(video?.characters) && video.characters.length > 0;
  if (key === "events") return (Array.isArray(video?.scenes) && video.scenes.length > 0) || (Array.isArray(video?.storyBeats) && video.storyBeats.length > 0);
  if (key === "locations") return Array.isArray(video?.locations) && video.locations.length > 0;
  if (key === "objects") return Array.isArray(video?.objects) && video.objects.length > 0;
  return false;
}

function expectedKindSourceIds(input, key) {
  const result = new Set();
  for (const video of Array.isArray(input?.videos) ? input.videos : []) {
    if (videoHasKind(video, key) && video?.videoId) result.add(String(video.videoId));
  }
  for (const partial of Array.isArray(input?.partials) ? input.partials : []) {
    collectVideoIds(partial?.[key], result);
  }
  if (input?.universe && typeof input.universe === "object") collectVideoIds(input.universe[key], result);
  return result;
}

function coverage(value, expected) {
  const actual = collectVideoIds(value);
  const missing = [...expected].filter((id) => !actual.has(id));
  return { actual, missing };
}

function validateKindCoverage(key, items, expected) {
  const result = coverage(items, expected);
  if (result.missing.length) {
    throw codedError(
      "UNIVERSE_COVERAGE_MISSING",
      `${key} birleştirmesi ${result.missing.length} kaynak videoyu kaybetti: ${result.missing.slice(0, 5).join(", ")}`,
    );
  }
  return result;
}

function splitArray(values) {
  const middle = Math.ceil(values.length / 2);
  return [values.slice(0, middle), values.slice(middle)];
}

function splitKindInput(input, key) {
  const videos = Array.isArray(input?.videos) ? input.videos : [];
  if (videos.length > 1) return splitArray(videos).map((part) => ({ videos: part }));
  const partials = Array.isArray(input?.partials) ? input.partials : [];
  if (partials.length > 1) return splitArray(partials).map((part) => ({ partials: part }));
  const items = partials.length === 1 && Array.isArray(partials[0]?.[key]) ? partials[0][key] : [];
  if (items.length > 1) return splitArray(items).map((part) => ({ partials: [{ [key]: part }] }));
  return [];
}

function normalizeName(value) {
  return cleanText(value, 260).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function uniqueText(...values) {
  const result = [];
  for (const value of values.flat()) {
    const text = cleanText(value, 6000);
    if (!text || result.includes(text)) continue;
    result.push(text);
  }
  return result;
}

function mergeText(left, right, max) {
  const first = cleanText(left, max);
  const second = cleanText(right, max);
  if (!first) return second;
  if (!second || first.includes(second)) return first;
  if (second.includes(first)) return second;
  return cleanText(`${first} ${second}`, max);
}

function mergeDetails(left, right) {
  const result = [];
  for (const detail of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const text = cleanText(typeof detail === "string" ? detail : detail?.text, 700);
    if (!text) continue;
    const found = result.find((entry) => normalizeName(entry.text) === normalizeName(text));
    const sourceVideoIds = uniqueText(detail?.sourceVideoIds ?? []);
    if (found) found.sourceVideoIds = uniqueText(found.sourceVideoIds, sourceVideoIds);
    else result.push({ text, sourceVideoIds });
  }
  return result;
}

function mergeVisual(left, right) {
  const first = left && typeof left === "object" ? left : {};
  const second = right && typeof right === "object" ? right : {};
  const richer = (a, b, max) => cleanText(a, max).length >= cleanText(b, max).length ? cleanText(a, max) : cleanText(b, max);
  return {
    description: richer(first.description, second.description, 1800),
    attributes: uniqueText(first.attributes ?? [], second.attributes ?? []),
    atmosphere: richer(first.atmosphere, second.atmosphere, 900),
    prompt: richer(first.prompt, second.prompt, 6000),
    negativePrompt: richer(first.negativePrompt, second.negativePrompt, 2400),
  };
}

function identityNames(entry) {
  return new Set([entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])].map(normalizeName).filter(Boolean));
}

function sameIdentity(left, right) {
  const leftNames = identityNames(left);
  return [...identityNames(right)].some((name) => leftNames.has(name));
}

function mergeEntity(left, right, key) {
  const aliases = uniqueText(left.aliases ?? [], right.aliases ?? [], normalizeName(left.name) === normalizeName(right.name) ? [] : [right.name]);
  const merged = {
    ...left,
    aliases,
    summary: mergeText(left.summary, right.summary, key === "stories" ? 5000 : 3000),
    sourceVideoIds: uniqueText(left.sourceVideoIds ?? [], right.sourceVideoIds ?? []),
    visual: mergeVisual(left.visual, right.visual),
  };
  if (key === "stories") {
    merged.sequence = mergeDetails(left.sequence, right.sequence);
    merged.characterNames = uniqueText(left.characterNames ?? [], right.characterNames ?? []);
    merged.locationNames = uniqueText(left.locationNames ?? [], right.locationNames ?? []);
    merged.objectNames = uniqueText(left.objectNames ?? [], right.objectNames ?? []);
  } else if (key === "events") {
    delete merged.aliases;
    merged.storyNames = uniqueText(left.storyNames ?? [], right.storyNames ?? []);
    merged.characterNames = uniqueText(left.characterNames ?? [], right.characterNames ?? []);
    merged.locationNames = uniqueText(left.locationNames ?? [], right.locationNames ?? []);
  } else {
    merged.details = mergeDetails(left.details, right.details);
    merged.storyNames = uniqueText(left.storyNames ?? [], right.storyNames ?? []);
    if (key === "characters") merged.roles = uniqueText(left.roles ?? [], right.roles ?? []);
  }
  return merged;
}

function consolidateKind(key, collections) {
  const result = [];
  for (const item of collections.flat()) {
    if (!item || typeof item !== "object" || !cleanText(item.name, 260)) continue;
    const foundIndex = result.findIndex((entry) => sameIdentity(entry, item));
    if (foundIndex < 0) result.push(item);
    else result[foundIndex] = mergeEntity(result[foundIndex], item, key);
  }
  return result;
}

function recoverableMergeError(error) {
  return ["AI_OUTPUT_MAX_TOKENS", "AI_OUTPUT_TRUNCATED", "UNIVERSE_COVERAGE_MISSING", "UNIVERSE_SCHEMA_INCOMPLETE", "AI_JSON_REPAIR_FAILED"].includes(error?.code);
}

async function requestKind(config, userDataPath, input, level, definition, depth, signal, activity) {
  const label = `universe-${definition.key}-level-${level}-part-${depth}-${[...collectVideoIds(input)].slice(0, 2).join("-")}`;
  const outputSchema = universeKindOutputSchema(definition.key);
  const requestActivity = activity ? {
    ...activity,
    label: `${definition.label[0].toLocaleUpperCase("tr-TR")}${definition.label.slice(1)} kümesini birleştir`,
    stage: `${activity.stage || "Evren Birleştirme"} · ${definition.label}`,
  } : null;
  const response = await requestCompletion(config, kindMessages(input, level, definition), outputSchema, OUTPUT_MAX_TOKENS, signal, requestActivity);
  let modelFallback = Boolean(response.fallbackUsed);
  let usedModel = response.model;
  assertCompleteResponse(userDataPath, label, response);
  const parsed = await aiJson.parseWithRepair(userDataPath, response.content, {
    label,
    repair: async (raw) => {
      aiActivity.note(activity?.sessionId, `${definition.label} yanıtı doğrudan ayrıştırılamadı; güvenli JSON onarımı isteniyor.`, {
        stage: `${activity?.stage || "Evren Birleştirme"} · JSON onarımı`,
      });
      const repaired = await requestCompletion(config, repairMessages(raw), outputSchema, OUTPUT_MAX_TOKENS, signal, activity ? {
        ...activity,
        label: `${definition.label} JSON yanıtını onar`,
        stage: `${activity.stage || "Evren Birleştirme"} · JSON onarımı`,
        attempt: "repair",
      } : null);
      modelFallback ||= Boolean(repaired.fallbackUsed);
      usedModel = repaired.model || usedModel;
      assertCompleteResponse(userDataPath, `${label}-repair`, repaired);
      return repaired.content;
    },
  });
  if (!Array.isArray(parsed.value?.items)) {
    throw codedError("UNIVERSE_SCHEMA_INCOMPLETE", `${definition.label} yanıtında zorunlu items dizisi yok.`);
  }
  const allowed = collectVideoIds(input);
  const items = normalizeUniverse({ [definition.key]: parsed.value.items }, allowed)[definition.key];
  validateKindCoverage(definition.key, items, expectedKindSourceIds(input, definition.key));
  return { items, repaired: parsed.repaired, fallback: false, modelFallback, model: usedModel };
}

async function mergeKind(config, userDataPath, input, level, definition, depth = 0, signal, activity) {
  const expected = expectedKindSourceIds(input, definition.key);
  if (!expected.size) return { items: [], repaired: false, fallback: false, modelFallback: false, model: "" };
  try {
    return await requestKind(config, userDataPath, input, level, definition, depth, signal, activity);
  } catch (error) {
    const parts = recoverableMergeError(error) ? splitKindInput(input, definition.key) : [];
    if (!parts.length) throw error;
    aiActivity.note(activity?.sessionId, `${definition.label} çağrısı daha küçük ${parts.length} parçaya bölünerek yeniden denenecek: ${String(error?.message ?? error).slice(0, 500)}`, {
      stage: `${activity?.stage || "Evren Birleştirme"} · Parçalı yeniden deneme`,
    });
    const results = [];
    for (const part of parts) results.push(await mergeKind(config, userDataPath, part, level, definition, depth + 1, signal, activity));
    const allowed = collectVideoIds(input);
    const items = normalizeUniverse({ [definition.key]: consolidateKind(definition.key, results.map((entry) => entry.items)) }, allowed)[definition.key];
    validateKindCoverage(definition.key, items, expected);
    return {
      items,
      repaired: results.some((entry) => entry.repaired),
      fallback: true,
      modelFallback: results.some((entry) => entry.modelFallback),
      model: [...results].reverse().find((entry) => entry.model)?.model || "",
    };
  }
}

function relationIdentity(entry) {
  return [entry.fromType, normalizeName(entry.fromName), entry.toType, normalizeName(entry.toName), normalizeName(entry.label)].join(":");
}

function consolidateRelations(values) {
  const result = [];
  const index = new Map();
  for (const relation of values) {
    if (!relation || typeof relation !== "object") continue;
    const key = relationIdentity(relation);
    if (!index.has(key)) {
      index.set(key, result.length);
      result.push(relation);
    } else {
      const target = result[index.get(key)];
      target.sourceVideoIds = uniqueText(target.sourceVideoIds ?? [], relation.sourceVideoIds ?? []);
    }
  }
  return result;
}

function entityResolver(values) {
  const index = new Map();
  for (const value of values) {
    for (const name of identityNames(value)) if (!index.has(name)) index.set(name, value);
  }
  return (name) => index.get(normalizeName(name));
}

function inputRelations(input) {
  const result = [];
  for (const partial of Array.isArray(input?.partials) ? input.partials : []) {
    if (Array.isArray(partial?.relations)) result.push(...partial.relations);
  }
  if (Array.isArray(input?.universe?.relations)) result.push(...input.universe.relations);
  return result;
}

function deriveRelations(input, universe, allowed) {
  const relations = [...inputRelations(input)];
  const resolvers = {
    story: entityResolver(universe.stories),
    character: entityResolver(universe.characters),
    event: entityResolver(universe.events),
    location: entityResolver(universe.locations),
    object: entityResolver(universe.objects),
  };
  const append = (fromType, from, toType, to, label, sources) => {
    if (!from || !to || (fromType === toType && normalizeName(from.name) === normalizeName(to.name))) return;
    relations.push({ fromType, fromName: from.name, toType, toName: to.name, label, sourceVideoIds: uniqueText(sources ?? []) });
  };
  for (const story of universe.stories) {
    for (const name of story.characterNames ?? []) append("story", story, "character", resolvers.character(name), "hikâyede yer alıyor", story.sourceVideoIds);
    for (const name of story.locationNames ?? []) append("story", story, "location", resolvers.location(name), "hikâyenin mekânı", story.sourceVideoIds);
    for (const name of story.objectNames ?? []) append("story", story, "object", resolvers.object(name), "hikâyede geçiyor", story.sourceVideoIds);
  }
  for (const character of universe.characters) {
    for (const name of character.storyNames ?? []) append("story", resolvers.story(name), "character", character, "hikâyede yer alıyor", character.sourceVideoIds);
  }
  for (const event of universe.events) {
    for (const name of event.storyNames ?? []) append("story", resolvers.story(name), "event", event, "hikâyedeki olay", event.sourceVideoIds);
    for (const name of event.characterNames ?? []) append("event", event, "character", resolvers.character(name), "olaya katılıyor", event.sourceVideoIds);
    for (const name of event.locationNames ?? []) append("event", event, "location", resolvers.location(name), "olayın mekânı", event.sourceVideoIds);
  }
  for (const location of universe.locations) {
    for (const name of location.storyNames ?? []) append("story", resolvers.story(name), "location", location, "hikâyenin mekânı", location.sourceVideoIds);
  }
  for (const object of universe.objects) {
    for (const name of object.storyNames ?? []) append("story", resolvers.story(name), "object", object, "hikâyede geçiyor", object.sourceVideoIds);
  }

  const canonical = [];
  for (const relation of normalizeUniverse({ relations }, allowed).relations) {
    const from = resolvers[relation.fromType]?.(relation.fromName);
    const to = resolvers[relation.toType]?.(relation.toName);
    if (!from || !to) continue;
    canonical.push({ ...relation, fromName: from.name, toName: to.name });
  }
  return consolidateRelations(canonical);
}

async function mergePayload(userDataPath, input, level, options = {}) {
  const config = privateConfig(userDataPath);
  const signal = options.signal;
  const allowed = collectVideoIds(input);
  if (!allowed.size) throw new Error("Evren birleştirme parçasında kaynak video kimliği bulunamadı.");

  const universe = { stories: [], characters: [], events: [], locations: [], objects: [], relations: [] };
  let repairedJson = false;
  let fallbackUsed = false;
  let modelFallbackUsed = false;
  let usedModel = "";
  for (const definition of KIND_DEFINITIONS) {
    aiActivity.note(options.activity?.sessionId, `${definition.label} için kaynak bağları hazırlanıyor.`, {
      stage: `${options.activity?.stage || "Evren Birleştirme"} · ${definition.label}`,
    });
    const merged = await mergeKind(config, userDataPath, input, level, definition, 0, signal, options.activity);
    universe[definition.key] = merged.items;
    repairedJson ||= merged.repaired;
    fallbackUsed ||= merged.fallback;
    modelFallbackUsed ||= merged.modelFallback;
    usedModel = merged.model || usedModel;
    aiActivity.note(options.activity?.sessionId, `${merged.items.length} ${definition.label} kaydı hazırlandı.`, {
      stage: `${options.activity?.stage || "Evren Birleştirme"} · ${definition.label} tamamlandı`,
      model: usedModel,
      tone: "success",
    });
  }
  universe.relations = deriveRelations(input, universe, allowed);
  const normalized = normalizeUniverse(universe, allowed);
  const totalCoverage = coverage(normalized, allowed);
  if (totalCoverage.missing.length) {
    throw codedError(
      "UNIVERSE_COVERAGE_MISSING",
      `Evren birleştirme ${totalCoverage.missing.length}/${allowed.size} kaynak videoyu sonuçta kaybetti: ${totalCoverage.missing.slice(0, 5).join(", ")}`,
    );
  }
  return { universe: normalized, model: usedModel || config.displayModel, repairedJson, fallbackUsed, modelFallbackUsed };
}

module.exports = {
  mergePayload,
  privateConfig,
  _test: {
    consolidateKind,
    deriveRelations,
    expectedKindSourceIds,
    looksTruncated,
    validateKindCoverage,
  },
};
