const { getConfig } = require("./ai-config.cjs");
const { chat, parseAssistantJson } = require("./ai-client.cjs");
const aiJson = require("./ai-json.cjs");
const aiActivity = require("./ai-activity.cjs");
const { ANALYSIS_OUTPUT_SCHEMA, SUGGESTION_OUTPUT_SCHEMA } = require("./ai-output-schemas.cjs");

function compactItem(item) {
  return {
    key: String(item.key ?? ""),
    kind: String(item.kind ?? ""),
    title: String(item.title ?? ""),
    meta: String(item.meta ?? ""),
    summary: String(item.summary ?? "").slice(0, 1600),
  };
}

function compactTranscript(value, maxChars = 36000) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const part = Math.floor(maxChars / 3);
  const middleStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(part / 2));
  return [
    "[TRANSKRİPT BAŞI]",
    text.slice(0, part),
    "[TRANSKRİPT ORTASI]",
    text.slice(middleStart, middleStart + part),
    "[TRANSKRİPT SONU]",
    text.slice(-part),
  ].join("\n");
}

function stringArray(value, limit, maxLength) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = String(entry ?? "").trim().slice(0, maxLength);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function visualProfile(value) {
  const entry = value && typeof value === "object" ? value : {};
  return {
    description: String(entry.description ?? "").trim().slice(0, 1800),
    attributes: stringArray(entry.attributes, 18, 300),
    atmosphere: String(entry.atmosphere ?? "").trim().slice(0, 900),
    prompt: String(entry.prompt ?? "").trim().slice(0, 6000),
    negativePrompt: String(entry.negativePrompt ?? "").trim().slice(0, 2400),
  };
}

function characterArray(value) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.name ?? "").trim().slice(0, 180);
    if (!name || result.some((item) => item.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) continue;
    const aliases = stringArray(entry.aliases, 8, 120);
    const role = String(entry.role ?? "").trim().slice(0, 300);
    const details = stringArray(entry.details, 16, 700);
    result.push({ name, aliases, role, details, visual: visualProfile(entry.visual) });
    if (result.length >= 16) break;
  }
  return result;
}

function namedVisualArray(value, limit = 12) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry === "string") {
      const name = entry.trim().slice(0, 180);
      if (name) result.push({ name, details: [], visual: visualProfile({}) });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.name ?? "").trim().slice(0, 180);
    if (!name || result.some((item) => item.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) continue;
    result.push({ name, details: stringArray(entry.details, 10, 500), visual: visualProfile(entry.visual) });
    if (result.length >= limit) break;
  }
  return result.slice(0, limit);
}

function sceneArray(value) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.name ?? "").trim().slice(0, 180);
    const description = String(entry.description ?? "").trim().slice(0, 1200);
    if (!name && !description) continue;
    result.push({ name: name || `Sahne ${result.length + 1}`, description, visual: visualProfile(entry.visual) });
    if (result.length >= 5) break;
  }
  return result;
}

function analysisRepairMessages(raw) {
  return [
    {
      role: "system",
      content: [
        "JSON onarım aracısın.",
        "Kullanıcı sana başka bir modelin bozuk, kesilmiş veya açıklama eklenmiş video çözümleme JSON çıktısını verecek.",
        "Anlamı değiştirme; yeni olay, karakter, mekân, nesne veya görsel ayrıntı üretme.",
        "Yalnız yanıtta bulunan ve güvenle kurtarılabilen veriyi koru.",
        "Token sınırında yarım kalmış son alanı güvenle tamamlayamıyorsan çıkar; açık dizi ve nesneleri sözdizimsel olarak kapat.",
        "Mevcut alan adlarını koru. Eksik alanları uydurma; uygulama eksik alanları boş değerlerle tamamlayacak.",
        "Markdown, code fence, açıklama veya giriş cümlesi yazma.",
        "Yanıtın ilk karakteri { ve son karakteri } olmalı. Yalnız tek bir geçerli JSON nesnesi döndür.",
      ].join(" "),
    },
    { role: "user", content: raw },
  ];
}

async function analyzeTranscript(userDataPath, input) {
  const transcript = compactTranscript(input?.transcript, 48000);
  if (!transcript) throw new Error("AI analizi için arşivlenmiş transkript gerekli.");
  const title = String(input?.title ?? "").trim().slice(0, 400);
  const publishedAt = String(input?.publishedAt ?? "").trim().slice(0, 32);
  const language = String(input?.language ?? "").trim().slice(0, 32);
  const prompt = { source: { title, publishedAt, language }, transcript };
  const completion = await chat(userDataPath, [
    {
      role: "system",
      content: [
        "Channel Foundry Studio için kanalın anlatı arşivini yapılandıran yerel hikâye çözümleme yardımcısısın.",
        "Bu yazılım doğruluk kontrolü yapmaz. Doğru, yanlış, gerçek, gerçek dışı, kanıt, teyit veya güvenilirlik değerlendirmesi yapma.",
        "Transkriptte anlatılanları kanalın anlatı evreninin kaynak metni olarak işle; yalnız verilen transkript ve metadata'yı kullan, dış bilgi ekleme.",
        "Transkript otomatik altyazı olabilir; bariz yazım veya duyma hatalarında bağlamı koru fakat yeni ayrıntı uydurma.",
        "title web sitesinde kullanılabilecek sade ve anlaşılır bir kayıt başlığı olsun.",
        "summary videodaki anlatının hikâye bağlamını koruyan kısa bir özeti olsun.",
        "topics en fazla 8 kısa ana tema olsun.",
        "storyBeats videodaki anlatının sırasını koruyan en fazla 12 önemli hikâye parçası veya gelişme olsun.",
        "storyHints bu videonun daha geniş arşivde bağlanabileceği en fazla 6 hikâye hattı için kısa aday adlar olsun.",
        "characters yalnız anlatıda rol oynayan kişi, varlık veya belirgin karakterleri içersin. Her karakter için name, aliases, role ve details çıkar.",
        "locations ve objects artık yalnız ad değil; name, details ve visual alanları taşısın.",
        "Görsel tanımlar web kartı/kapak görseli üretmek için kullanılacak. Yalnız transkriptte bulunan fiziksel veya çevresel ayrıntıları kesin nitelik olarak yaz; bilinmeyen tür, boy, kıyafet, renk, yüz veya beden özelliklerini uydurma.",
        "Her visual nesnesi description, attributes, atmosphere, prompt ve negativePrompt taşısın. attributes içinde biliniyorsa 'Varlık türü: ...', 'Boy: ...', 'Fiziksel yapı: ...', 'Kıyafet: ...', 'Belirgin özellik: ...' gibi kısa maddeler kullanılabilir.",
        "visual.prompt bağımsız bir görsel üretim servisine kopyalanabilecek, özneyi ve atmosferi açık anlatan Türkçe bir üretim metni olsun. Belirsiz fiziksel ayrıntıları nötr bırak.",
        "coverVisual bu videonun/hikâye kaydının genel kapak görseli için tanım olsun.",
        "scenes en fazla 5 önemli olay/sahne için name, description ve visual içersin; bunlar ileride olay kartlarına dönüşebilir.",
        "Bir bilgiyi iddia, şüphe veya doğrulanması gereken unsur olarak sınıflandırma; anlatının bir parçası olarak yapılandır.",
        "Yalnız JSON döndür: {\"title\":\"...\",\"summary\":\"...\",\"topics\":[\"...\"],\"storyBeats\":[\"...\"],\"storyHints\":[\"...\"],\"coverVisual\":{\"description\":\"...\",\"attributes\":[\"...\"],\"atmosphere\":\"...\",\"prompt\":\"...\",\"negativePrompt\":\"...\"},\"characters\":[{\"name\":\"...\",\"aliases\":[\"...\"],\"role\":\"...\",\"details\":[\"...\"],\"visual\":{\"description\":\"...\",\"attributes\":[\"...\"],\"atmosphere\":\"...\",\"prompt\":\"...\",\"negativePrompt\":\"...\"}}],\"locations\":[{\"name\":\"...\",\"details\":[\"...\"],\"visual\":{\"description\":\"...\",\"attributes\":[\"...\"],\"atmosphere\":\"...\",\"prompt\":\"...\",\"negativePrompt\":\"...\"}}],\"objects\":[{\"name\":\"...\",\"details\":[\"...\"],\"visual\":{\"description\":\"...\",\"attributes\":[\"...\"],\"atmosphere\":\"...\",\"prompt\":\"...\",\"negativePrompt\":\"...\"}}],\"scenes\":[{\"name\":\"...\",\"description\":\"...\",\"visual\":{\"description\":\"...\",\"attributes\":[\"...\"],\"atmosphere\":\"...\",\"prompt\":\"...\",\"negativePrompt\":\"...\"}}]}",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(prompt) },
  ], {
    json: true,
    outputSchema: ANALYSIS_OUTPUT_SCHEMA,
    temperature: 0.1,
    maxTokens: 6500,
    signal: input?.signal,
    returnMeta: true,
    activity: input?.activity ? { ...input.activity, stage: "Video çözümleme", label: "Transkript ve video bilgisini çözümle" } : null,
  });
  const content = completion.content;
  let usedModel = completion.model;
  let modelFallbackUsed = Boolean(completion.fallbackUsed);
  aiActivity.note(input?.activity?.sessionId, "Model yanıtı alındı; JSON yapısı ve zorunlu alanlar denetleniyor.", {
    stage: "Yanıt doğrulama",
    model: usedModel,
  });
  const parsedResult = await aiJson.parseWithRepair(userDataPath, content, {
    label: `video-analysis-${String(input?.videoId ?? "unknown")}`,
    repair: async (raw) => {
      aiActivity.note(input?.activity?.sessionId, "İlk yanıt doğrudan ayrıştırılamadı; güvenli JSON onarımı isteniyor.", {
        stage: "JSON onarımı",
      });
      const repaired = await chat(userDataPath, analysisRepairMessages(raw), {
        json: true,
        outputSchema: ANALYSIS_OUTPUT_SCHEMA,
        temperature: 0,
        maxTokens: 7000,
        signal: input?.signal,
        returnMeta: true,
        activity: input?.activity ? { ...input.activity, stage: "JSON onarımı", label: "Kesilmiş veya bozuk JSON yanıtını onar", attempt: "repair" } : null,
      });
      if (repaired.fallbackUsed) usedModel = repaired.model;
      modelFallbackUsed ||= Boolean(repaired.fallbackUsed);
      return repaired.content;
    },
  });
  const parsed = parsedResult.value;
  aiActivity.note(input?.activity?.sessionId, parsedResult.repaired
    ? "Onarılan yanıt doğrulandı; anlatı dosyası yerel kayıt biçimine dönüştürülüyor."
    : "Yanıt doğrulandı; anlatı dosyası yerel kayıt biçimine dönüştürülüyor.", {
    stage: "Sonuç hazırlanıyor",
    model: usedModel,
    tone: "success",
  });
  return {
    title: String(parsed.title ?? title).trim().slice(0, 300) || title,
    summary: String(parsed.summary ?? "").trim().slice(0, 12000),
    topics: stringArray(parsed.topics, 8, 140),
    storyBeats: stringArray(parsed.storyBeats, 12, 900),
    storyHints: stringArray(parsed.storyHints, 6, 180),
    coverVisual: visualProfile(parsed.coverVisual),
    characters: characterArray(parsed.characters),
    locations: namedVisualArray(parsed.locations),
    objects: namedVisualArray(parsed.objects),
    scenes: sceneArray(parsed.scenes),
    config: { ...getConfig(userDataPath), model: usedModel, modelFallbackUsed },
  };
}

async function suggestContent(userDataPath, input) {
  const selected = input?.selected;
  if (!selected?.key || !selected?.title) throw new Error("AI önerisi için bir içerik seçilmeli.");
  const existingRelations = Array.isArray(input?.related) ? input.related.map(compactItem).slice(0, 12) : [];
  const candidates = Array.isArray(input?.candidates) ? input.candidates.map(compactItem).filter((item) => item.key && item.key !== selected.key).slice(0, 30) : [];
  const allowedKeys = new Set(candidates.map((item) => item.key));
  const transcript = compactTranscript(input?.transcript);
  const prompt = {
    selected: compactItem(selected),
    alreadyRelated: existingRelations,
    relationCandidates: candidates,
    ...(transcript ? { archivedTranscript: transcript } : {}),
  };
  const content = await chat(userDataPath, [
    {
      role: "system",
      content: [
        "Channel Foundry Studio için editoryal yardımcı asistansın.",
        "Karar vermezsin; yalnız kullanıcıya öneri sunarsın.",
        "Verilen bağlamda olmayan olay, kişi, tarih veya anlatı ayrıntısı uydurma.",
        transcript
          ? "archivedTranscript videonun yerel arşivlenmiş konuşma metnidir; özet ve başlık önerisinde bunu birincil içerik kaynağı olarak kullan."
          : "Transkript verilmedi; videoda veya kayıtta söylenmiş olabilecek içerikleri tahmin etme, yalnız metadata ile çalış.",
        "Başlığı gerekiyorsa sadeleştir; özet yalnız verilen içerikteki bilgiyi daha okunur hale getirsin.",
        "İlişki adayları yalnız relationCandidates içindeki key değerlerinden seçilebilir.",
        "En fazla 5 ilişki öner.",
        "Yalnız JSON döndür: {\"title\":\"...\",\"summary\":\"...\",\"relations\":[{\"key\":\"...\",\"label\":\"...\",\"reason\":\"...\"}]}",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(prompt) },
  ], { json: true, outputSchema: SUGGESTION_OUTPUT_SCHEMA, temperature: 0.1, maxTokens: 1100 });
  const parsed = parseAssistantJson(content);
  const suggestedTitle = String(parsed.title ?? selected.title).trim().slice(0, 300) || String(selected.title);
  const summary = String(parsed.summary ?? selected.summary ?? "").trim().slice(0, 12000);
  const relations = [];
  for (const relation of Array.isArray(parsed.relations) ? parsed.relations : []) {
    const key = String(relation?.key ?? "").trim();
    if (!allowedKeys.has(key) || relations.some((item) => item.key === key)) continue;
    relations.push({
      key,
      label: String(relation?.label ?? "bağlantılı").trim().slice(0, 120) || "bağlantılı",
      reason: String(relation?.reason ?? "").trim().slice(0, 600),
    });
    if (relations.length >= 5) break;
  }
  return { title: suggestedTitle, summary, relations, config: getConfig(userDataPath) };
}

module.exports = { analyzeTranscript, compactTranscript, suggestContent, visualProfile };
