const MAX_SESSIONS = 24;
const MAX_EVENTS_PER_SESSION = 180;
const MAX_EVENT_TEXT = 80000;
const MAX_SESSION_EVENT_CHARS = 3000000;

const sessions = [];
let sequence = 0;

function now() {
  return new Date().toISOString();
}

function text(value, limit = MAX_EVENT_TEXT) {
  const source = typeof value === "string" ? value : value == null ? "" : safeStringify(value);
  if (source.length <= limit) return { content: source, characters: source.length, truncated: false };
  return {
    content: `${source.slice(0, limit)}\n\n[Gösterim sınırı nedeniyle ${source.length - limit} karakter gizlendi.]`,
    characters: source.length,
    truncated: true,
  };
}

function safeStringify(value) {
  try { return JSON.stringify(value); } catch { return String(value ?? ""); }
}

function sessionById(id) {
  const value = String(id ?? "").trim();
  return value ? sessions.find((session) => session.id === value) ?? null : null;
}

function eventSize(event) {
  return safeStringify(event).length;
}

function appendEvent(session, input) {
  const event = {
    id: `${session.id}:event:${++sequence}`,
    at: now(),
    ...input,
  };
  session.events.push(event);
  session.eventCharacters += eventSize(event);
  session.updatedAt = event.at;

  while (
    session.events.length > 1
    && (session.events.length > MAX_EVENTS_PER_SESSION || session.eventCharacters > MAX_SESSION_EVENT_CHARS)
  ) {
    const removed = session.events.shift();
    session.eventCharacters = Math.max(0, session.eventCharacters - eventSize(removed));
    session.omittedEventCount += 1;
  }
  return event;
}

function summary(session) {
  if (!session) return null;
  const end = session.finishedAt ? Date.parse(session.finishedAt) : Date.now();
  const start = Date.parse(session.startedAt);
  return {
    id: session.id,
    key: session.key,
    kind: session.kind,
    title: session.title,
    subject: session.subject,
    state: session.state,
    provider: session.provider,
    configuredModel: session.configuredModel,
    model: session.model,
    fallbackUsed: session.fallbackUsed,
    stage: session.stage,
    detail: session.detail,
    requestCount: session.requestCount,
    responseCount: session.responseCount,
    errorCount: session.errorCount,
    omittedEventCount: session.omittedEventCount,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    finishedAt: session.finishedAt,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0,
    context: { ...session.context },
  };
}

function trimSessions() {
  if (sessions.length <= MAX_SESSIONS) return;
  const removable = sessions
    .filter((session) => session.state !== "running")
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  while (sessions.length > MAX_SESSIONS && removable.length) {
    const target = removable.shift();
    const index = sessions.indexOf(target);
    if (index >= 0) sessions.splice(index, 1);
  }
}

function normalizedKind(value) {
  if (value === "universe") return "universe";
  if (value === "visual") return "visual";
  return "analysis";
}

function defaultTitle(kind) {
  if (kind === "universe") return "Evrene İşleme";
  if (kind === "visual") return "Görsel üretimi";
  return "Video çözümleme";
}

function startSession(input = {}) {
  const key = String(input.key ?? "").trim();
  const existing = key
    ? sessions.find((session) => session.key === key && session.state === "running")
    : null;
  if (existing) return summary(existing);

  const startedAt = now();
  const kind = normalizedKind(input.kind);
  const configuredModel = String(input.configuredModel ?? "").trim();
  const session = {
    id: `${kind}-${Date.now().toString(36)}-${++sequence}`,
    key,
    kind,
    title: String(input.title ?? defaultTitle(kind)).trim(),
    subject: String(input.subject ?? "").trim(),
    state: "running",
    provider: String(input.provider ?? "").trim(),
    configuredModel,
    model: "",
    fallbackUsed: false,
    stage: String(input.stage ?? "Hazırlanıyor").trim(),
    detail: String(input.detail ?? "").trim(),
    requestCount: 0,
    responseCount: 0,
    errorCount: 0,
    omittedEventCount: 0,
    eventCharacters: 0,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    context: input.context && typeof input.context === "object" ? { ...input.context } : {},
    events: [],
  };
  sessions.push(session);
  appendEvent(session, {
    type: "status",
    tone: "info",
    label: session.stage,
    message: String(input.message ?? "AI işlemi hazırlandı.").trim(),
  });
  trimSessions();
  return summary(session);
}

function note(sessionId, message, input = {}) {
  const session = sessionById(sessionId);
  if (!session) return null;
  const stage = String(input.stage ?? "").trim();
  const detail = String(input.detail ?? "").trim();
  const model = String(input.model ?? "").trim();
  if (stage) session.stage = stage;
  if (detail) session.detail = detail;
  if (model) session.model = model;
  return appendEvent(session, {
    type: "status",
    tone: input.tone === "success" || input.tone === "error" ? input.tone : "info",
    label: stage || session.stage,
    message: String(message ?? "").trim(),
  });
}

function normalizedMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const value = text(message?.content);
    return {
      role: ["system", "assistant", "model"].includes(message?.role) ? String(message.role) : "user",
      ...value,
    };
  });
}

function beginRequest(activity, input = {}) {
  const session = sessionById(activity?.sessionId);
  if (!session) return null;
  const model = String(input.model ?? "").trim();
  const provider = String(input.provider ?? session.provider).trim();
  const label = String(activity?.label ?? input.label ?? "AI isteği").trim();
  const stage = String(activity?.stage ?? input.stage ?? label).trim();
  const attempt = activity?.attempt === "fallback" || input.attempt === "fallback" ? "fallback" : activity?.attempt === "repair" || input.attempt === "repair" ? "repair" : "primary";
  const requestId = `${session.id}:request:${++sequence}`;
  session.stage = stage;
  session.detail = label;
  if (provider) session.provider = provider;
  if (model) session.model = model;
  if (attempt === "fallback") session.fallbackUsed = true;
  session.requestCount += 1;
  appendEvent(session, {
    type: "request",
    requestId,
    label,
    stage,
    attempt,
    provider,
    model,
    messages: normalizedMessages(input.messages),
    settings: {
      temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : null,
      maxTokens: Number.isFinite(Number(input.maxTokens)) ? Number(input.maxTokens) : null,
      json: Boolean(input.json),
      reasoningEffort: String(input.reasoningEffort ?? "").trim(),
    },
  });
  return { sessionId: session.id, requestId, startedAt: Date.now() };
}

function completeRequest(request, input = {}) {
  const session = sessionById(request?.sessionId);
  if (!session || !request?.requestId) return null;
  const model = String(input.model ?? session.model).trim();
  const value = text(input.content);
  if (model) session.model = model;
  session.responseCount += 1;
  session.detail = String(input.label ?? session.detail).trim();
  return appendEvent(session, {
    type: "response",
    requestId: request.requestId,
    label: String(input.label ?? "Model yanıtı").trim(),
    model,
    finishReason: String(input.finishReason ?? "").trim(),
    durationMs: Math.max(0, Date.now() - Number(request.startedAt ?? Date.now())),
    ...value,
  });
}

function failRequest(request, error, input = {}) {
  const session = sessionById(request?.sessionId);
  if (!session || !request?.requestId) return null;
  const message = error instanceof Error ? error.message : String(error ?? "Bilinmeyen AI hatası");
  session.errorCount += 1;
  session.detail = message;
  return appendEvent(session, {
    type: "error",
    requestId: request.requestId,
    label: String(input.label ?? "AI isteği başarısız").trim(),
    code: String(error?.code ?? "").trim(),
    message: message.slice(0, MAX_EVENT_TEXT),
    durationMs: Math.max(0, Date.now() - Number(request.startedAt ?? Date.now())),
  });
}

function finishSession(sessionId, input = {}) {
  const session = sessionById(sessionId);
  if (!session) return null;
  const state = ["done", "error", "canceled"].includes(input.state) ? input.state : "done";
  const model = String(input.model ?? "").trim();
  const detail = String(input.detail ?? "").trim();
  if (model) session.model = model;
  if (detail) session.detail = detail;
  session.state = state;
  session.stage = String(input.stage ?? (state === "done" ? "Tamamlandı" : state === "canceled" ? "Durduruldu" : "Hata")).trim();
  session.finishedAt = now();
  appendEvent(session, {
    type: "status",
    tone: state === "done" ? "success" : state === "error" ? "error" : "info",
    label: session.stage,
    message: detail || (state === "done" ? "AI işlemi tamamlandı." : state === "canceled" ? "AI işlemi kullanıcı tarafından durduruldu." : "AI işlemi tamamlanamadı."),
  });
  trimSessions();
  return summary(session);
}

function snapshot(input = {}) {
  const ordered = [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const active = ordered.find((session) => session.state === "running") ?? null;
  const selectedId = String(input?.sessionId ?? "").trim();
  const selected = sessionById(selectedId) ?? (input?.includeEvents ? active ?? ordered[0] ?? null : null);
  return {
    activeSessionId: active?.id ?? null,
    activeModel: active?.model || active?.configuredModel || "",
    latestModel: ordered.find((session) => session.model)?.model || "",
    sessions: ordered.map(summary),
    selectedSession: selected && input?.includeEvents
      ? { ...summary(selected), events: selected.events.map((event) => ({ ...event, messages: event.messages?.map((message) => ({ ...message })) })) }
      : null,
  };
}

function resetForTests() {
  sessions.splice(0, sessions.length);
  sequence = 0;
}

module.exports = {
  beginRequest,
  completeRequest,
  failRequest,
  finishSession,
  note,
  snapshot,
  startSession,
  _resetForTests: resetForTests,
};
