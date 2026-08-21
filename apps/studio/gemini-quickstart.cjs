const GOOGLE_API_HOST = "generativelanguage.googleapis.com";

function readHeaderValue(source, name) {
  const flags = /(?:^|\s)(?:-H|--header)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|([^\s\\]+))/gi;
  let match;
  while ((match = flags.exec(source))) {
    const header = String(match[1] ?? match[2] ?? match[3] ?? "").trim();
    const separator = header.indexOf(":");
    if (separator < 1) continue;
    if (header.slice(0, separator).trim().toLowerCase() === name.toLowerCase()) {
      return header.slice(separator + 1).trim();
    }
  }
  return "";
}

function quickstartError(message) {
  return new Error(`Google AI Studio cURL Quickstart okunamadı: ${message}`);
}

function parseGoogleAiStudioQuickstart(value) {
  const source = String(value ?? "").trim();
  if (!source) throw quickstartError("cURL metni boş.");
  if (!/^\s*curl(?:\s|\\\r?\n)/i.test(source)) throw quickstartError("metin curl komutuyla başlamalı.");

  const urlMatch = source.match(/https:\/\/generativelanguage\.googleapis\.com\/[^\s"'\\]+/i);
  if (!urlMatch) throw quickstartError("Google Generative Language adresi bulunamadı.");

  let url;
  try {
    url = new URL(urlMatch[0]);
  } catch {
    throw quickstartError("endpoint adresi geçersiz.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== GOOGLE_API_HOST) {
    throw quickstartError("yalnız Google AI Studio endpoint'i kabul edilir.");
  }

  const route = url.pathname.match(/^\/(v1(?:beta|alpha)?|v1)\/models\/([^/:]+):generateContent\/?$/i);
  if (!route) throw quickstartError("generateContent model adresi bulunamadı.");

  let model;
  try {
    model = decodeURIComponent(route[2]).trim();
  } catch {
    throw quickstartError("model kimliği çözümlenemedi.");
  }
  if (!model) throw quickstartError("model kimliği boş.");

  const apiKey = readHeaderValue(source, "X-goog-api-key") || url.searchParams.get("key")?.trim() || "";
  if (!apiKey) throw quickstartError("X-goog-api-key başlığı bulunamadı.");

  const version = route[1].toLowerCase();
  return {
    endpoint: `https://${GOOGLE_API_HOST}/${version}`,
    model,
    apiKey,
  };
}

module.exports = {
  GOOGLE_API_HOST,
  parseGoogleAiStudioQuickstart,
};
