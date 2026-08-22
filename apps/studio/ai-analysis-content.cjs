const { getConfig } = require("./ai-config.cjs");
const { chat } = require("./ai-client.cjs");
const aiJson = require("./ai-json.cjs");
const aiActivity = require("./ai-activity.cjs");
const baseContent = require("./ai-content.cjs");
const { ANALYSIS_OUTPUT_SCHEMA } = require("./ai-output-schemas.cjs");

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
  return baseContent.visualProfile(value);
}

function characterArray(value) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.name ?? "").trim().slice(0, 180);
    if (!name || result.some((item) => item.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) continue;
    result.push({
      name,
      aliases: stringArray(entry.aliases, 8, 120),
      role: String(entry.role ?? "").trim().slice(0, 300),
      details: stringArray(entry.details, 16, 700),
      visual: visualProfile(entry.visual),
    });
    if (result.length >= 16) break;
  }
  return result;
}

function namedVisualArray(value, limit = 12) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.name ?? "").trim().slice(0, 180);
    if (!name || result.some((item) => item.name.toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"))) continue;
    result.push({ name, details: stringArray(entry.details, 10, 500), visual: visualProfile(entry.visual) });
    if (result.length >= limit) break;
  }
  return result;
}

function sceneArray(value) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== "object") continue;
    const name = String(entry.name ?? "").trim().slice(0, 180);
    const description = String(entry.description ?? "").trim().slice(0, 1200);
    if (!name && !description) continue;
    result.push({ name: name || `Sahne ${result.length + 1}`, description, visual: visualProfile(entry.visual) });
    if (result.length >= 8) break;
  }
  return result;
}

function repairMessages(raw) {
  return [
    {
      role: "system",
      content: [
        "JSON onarım aracısın.",
        "Başka bir modelin bozuk veya kesilmiş video çözümleme JSON çıktısını onar.",
        "Yeni olay, karakter, sponsor, katkıda bulunan, mekân, nesne veya ayrıntı üretme.",
        "Yalnız yanıtta güvenle bulunan veriyi koru ve eksik alanları boş dizi/nesne/metin ile tamamla.",
        "Markdown veya açıklama yazma; yalnız tek geçerli JSON nesnesi döndür.",
      ].join(" "),
    },
    { role: "user", content: raw },
  ];
}

async function analyzeTranscript(userDataPath, input) {
  const transcript = baseContent.compactTranscript(input?.transcript, 48000);
  if (!transcript) throw new Error("AI analizi için arşivlenmiş transkript gerekli.");
  const title = String(input?.title ?? "").trim().slice(0, 400);
  const publishedAt = String(input?.publishedAt ?? "").trim().slice(0, 32);
  const language = String(input?.language ?? "").trim().slice(0, 32);
  const prompt = { source: { title, publishedAt, language }, transcript };
  const completion = await chat(userDataPath, [
    {
      role: "system",
      content: [
        "Channel Foundry Studio için kanalın kaynak videosunu yapılandıran editoryal çözümleme yardımcısısın.",
        "Doğruluk veya güvenilirlik değerlendirmesi yapma; yalnız verilen transkript ve metadata'yı kullan.",
        "Çıktıyı iki zihinsel sınıfa ayır: EVREN MALZEMESİ ve KANAL DESTEK KAYITLARI.",
        "EVREN MALZEMESİ: title, summary, topics, storyBeats, storyHints, characters, locations, objects, scenes ve coverVisual.",
        "KANAL DESTEK KAYITLARI: sponsors ve contributors. Bu isimler evren karakteri/muhatabı değildir.",
        "sponsors yalnız videoda sponsor, destekçi veya özellikle 'Destekçi Kaydı'na yazılan isim olarak açıkça anılan kişileri içersin.",
        "contributors yalnız video sonunda teşekkür edilen veya katkıda bulunan olarak okunan isimleri içersin.",
        "Sponsor veya katkıda bulunan bir isim, anlatıda ayrıca bağımsız bir rol oynamıyorsa characters alanına kesinlikle eklenmesin.",
        "Bir isim sponsor/katkı bağlamında geçiyor ama kimliği belirsizse uydurma yapma; listeye ekleme.",
        "storyBeats videodaki önemli anlatı parçalarını, storyHints daha geniş hikâye hattı adaylarını taşısın.",
        "characters yalnız anlatının içinde rol oynayan kişi, varlık veya belirgin muhatapları içersin.",
        "locations, objects ve scenes yalnız evren açısından anlamlı adayları içersin; sponsor/teşekkür bölümündeki rastlantısal sözcüklerden aday üretme.",
        "Her visual nesnesi description, attributes, atmosphere, prompt ve negativePrompt taşısın; bilinmeyen fiziksel ayrıntıları uydurma.",
        "Yalnız JSON döndür ve bütün alanları yaz: {title,summary,topics,storyBeats,storyHints,coverVisual,characters,locations,objects,scenes,sponsors,contributors}.",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(prompt) },
  ], {
    json: true,
    outputSchema: ANALYSIS_OUTPUT_SCHEMA,
    temperature: 0.1,
    maxTokens: 7000,
    signal: input?.signal,
    returnMeta: true,
    activity: input?.activity ? { ...input.activity, stage: "Video çözümleme", label: "Evren malzemesi ve kanal destek kayıtlarını çözümle" } : null,
  });

  let usedModel = completion.model;
  let modelFallbackUsed = Boolean(completion.fallbackUsed);
  const parsedResult = await aiJson.parseWithRepair(userDataPath, completion.content, {
    label: `video-analysis-${String(input?.videoId ?? "unknown")}`,
    repair: async (raw) => {
      aiActivity.note(input?.activity?.sessionId, "Çözümleme JSON'u onarılıyor.", { stage: "JSON onarımı" });
      const repaired = await chat(userDataPath, repairMessages(raw), {
        json: true,
        outputSchema: ANALYSIS_OUTPUT_SCHEMA,
        temperature: 0,
        maxTokens: 7200,
        signal: input?.signal,
        returnMeta: true,
        activity: input?.activity ? { ...input.activity, stage: "JSON onarımı", label: "Çözümleme JSON'unu onar", attempt: "repair" } : null,
      });
      if (repaired.fallbackUsed) usedModel = repaired.model;
      modelFallbackUsed ||= Boolean(repaired.fallbackUsed);
      return repaired.content;
    },
  });
  const parsed = parsedResult.value;
  aiActivity.note(input?.activity?.sessionId, "Çözümleme kaynak kaydına hazırlanıyor; editoryal ayıklama daha sonra yapılacak.", {
    stage: "Sonuç hazırlanıyor",
    model: usedModel,
    tone: "success",
  });

  return {
    title: String(parsed.title ?? title).trim().slice(0, 300) || title,
    summary: String(parsed.summary ?? "").trim().slice(0, 12000),
    topics: stringArray(parsed.topics, 8, 140),
    storyBeats: stringArray(parsed.storyBeats, 20, 900),
    storyHints: stringArray(parsed.storyHints, 10, 180),
    coverVisual: visualProfile(parsed.coverVisual),
    characters: characterArray(parsed.characters),
    locations: namedVisualArray(parsed.locations, 20),
    objects: namedVisualArray(parsed.objects, 20),
    scenes: sceneArray(parsed.scenes),
    sponsors: stringArray(parsed.sponsors, 200, 260),
    contributors: stringArray(parsed.contributors, 200, 260),
    config: { ...getConfig(userDataPath), model: usedModel, modelFallbackUsed },
  };
}

module.exports = { analyzeTranscript };
