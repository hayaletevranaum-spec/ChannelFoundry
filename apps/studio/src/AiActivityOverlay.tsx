import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  initialSnapshot: StudioAiActivitySnapshot | null;
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dateFormatter.format(parsed);
}

function clock(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : timeFormatter.format(parsed);
}

function duration(value: number) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return `${minutes} dk ${remaining} sn`;
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`;
}

function stateLabel(state: StudioAiActivityState) {
  if (state === "running") return "Çalışıyor";
  if (state === "done") return "Tamamlandı";
  if (state === "error") return "Hata";
  return "Durduruldu";
}

function kindLabel(kind: string) {
  if (kind === "universe") return "EVREN BİRLEŞTİRME";
  if (kind === "visual") return "GÖRSEL ÜRETİMİ";
  return "VİDEO ÇÖZÜMLEME";
}

function roleLabel(role: StudioAiActivityMessage["role"]) {
  if (role === "system") return "SİSTEM MESAJI";
  if (role === "assistant" || role === "model") return "MODEL MESAJI";
  return "KULLANICI MESAJI";
}

function attemptLabel(attempt: StudioAiActivityEvent["attempt"]) {
  if (attempt === "fallback") return "Yedek model";
  if (attempt === "repair") return "JSON onarımı";
  return "Ana çağrı";
}

function formatted(value: string) {
  const source = String(value || "").trim();
  if (!source || !/^[{[]/.test(source)) return value;
  try { return JSON.stringify(JSON.parse(source), null, 2); } catch { return value; }
}

function Content({ value }: { value: string }) {
  const output = useMemo(() => formatted(value), [value]);
  return <pre>{output}</pre>;
}

function SessionButton({ session, active, onClick }: { session: StudioAiActivitySession; active: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} onClick={onClick}>
    <span className="ai-log-session-top"><small>{kindLabel(session.kind)}</small><time>{date(session.updatedAt)}</time></span>
    <strong>{session.subject || session.title}</strong>
    <span className="ai-log-session-bottom"><i className={session.state}/>{stateLabel(session.state)}<b>{session.model || session.configuredModel || "Model bekleniyor"}</b></span>
  </button>;
}

function StatusEvent({ event }: { event: StudioAiActivityEvent }) {
  return <article className={`ai-log-event status ${event.tone || "info"}`}>
    <i className="ai-log-event-dot"/>
    <div className="ai-log-event-body">
      <header><strong>{event.label || "İşlem durumu"}</strong><time dateTime={event.at}>{clock(event.at)}</time></header>
      {event.message && <p>{event.message}</p>}
    </div>
  </article>;
}

function RequestEvent({ event }: { event: StudioAiActivityEvent }) {
  return <article className="ai-log-event request">
    <i className="ai-log-event-dot"/>
    <div className="ai-log-event-body">
      <header><div><small>MODELE GÖNDERİLEN İSTEK</small><strong>{event.label || "AI isteği"}</strong></div><time dateTime={event.at}>{clock(event.at)}</time></header>
      <div className="ai-log-event-meta">
        <span>{attemptLabel(event.attempt)}</span>
        {event.provider && <span>{event.provider}</span>}
        {event.model && <code>{event.model}</code>}
        {event.settings?.maxTokens != null && <span>En çok {event.settings.maxTokens} token</span>}
        {event.settings?.temperature != null && <span>Sıcaklık {event.settings.temperature}</span>}
        {event.settings?.reasoningEffort && <span>Reasoning {event.settings.reasoningEffort}</span>}
        {event.settings?.json && <span>JSON</span>}
      </div>
      <details>
        <summary>Gönderilen mesajları göster <b>{event.messages?.length ?? 0}</b></summary>
        <div className="ai-log-messages">{(event.messages ?? []).map((message, index) => <section key={`${event.id}:message:${index}`}>
          <div><strong>{roleLabel(message.role)}</strong><span>{message.characters.toLocaleString("tr-TR")} karakter{message.truncated ? " · görünüm kısaltıldı" : ""}</span></div>
          <Content value={message.content}/>
        </section>)}</div>
      </details>
    </div>
  </article>;
}

function ResponseEvent({ event, latest }: { event: StudioAiActivityEvent; latest: boolean }) {
  const [expanded, setExpanded] = useState(latest);
  return <article className="ai-log-event response">
    <i className="ai-log-event-dot"/>
    <div className="ai-log-event-body">
      <header><div><small>MODEL CEVABI</small><strong>{event.label || "Yanıt alındı"}</strong></div><time dateTime={event.at}>{clock(event.at)}</time></header>
      <div className="ai-log-event-meta">
        {event.model && <code>{event.model}</code>}
        {event.durationMs != null && <span>{duration(event.durationMs)}</span>}
        {event.finishReason && <span>Bitiş: {event.finishReason}</span>}
        {event.characters != null && <span>{event.characters.toLocaleString("tr-TR")} karakter</span>}
        {event.truncated && <span>Görünüm kısaltıldı</span>}
      </div>
      <details open={expanded} onToggle={(toggleEvent) => setExpanded(toggleEvent.currentTarget.open)}>
        <summary>Model cevabını {expanded ? "gizle" : "göster"}</summary>
        <Content value={event.content || ""}/>
      </details>
    </div>
  </article>;
}

function ErrorEvent({ event }: { event: StudioAiActivityEvent }) {
  return <article className="ai-log-event error">
    <i className="ai-log-event-dot"/>
    <div className="ai-log-event-body">
      <header><div><small>ÇAĞRI HATASI</small><strong>{event.label || "AI isteği başarısız"}</strong></div><time dateTime={event.at}>{clock(event.at)}</time></header>
      <div className="ai-log-event-meta">{event.code && <code>{event.code}</code>}{event.durationMs != null && <span>{duration(event.durationMs)}</span>}</div>
      <p>{event.message || "Bilinmeyen AI hatası"}</p>
    </div>
  </article>;
}

function Event({ event, latestResponseId }: { event: StudioAiActivityEvent; latestResponseId: string }) {
  if (event.type === "request") return <RequestEvent event={event}/>;
  if (event.type === "response") return <ResponseEvent event={event} latest={event.id === latestResponseId}/>;
  if (event.type === "error") return <ErrorEvent event={event}/>;
  return <StatusEvent event={event}/>;
}

export default function AiActivityOverlay({ open, onClose, initialSnapshot }: Props) {
  const bridge = window.birdesengorStudio;
  const closeButton = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<StudioAiActivitySnapshot | null>(initialSnapshot);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => closeButton.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !initialSnapshot) return;
    setSnapshot((current) => current?.selectedSession ? current : initialSnapshot);
    setSelectedId((current) => current && initialSnapshot.sessions.some((session) => session.id === current)
      ? current
      : initialSnapshot.activeSessionId || initialSnapshot.sessions[0]?.id || "");
  }, [open, initialSnapshot]);

  useEffect(() => {
    if (!open || !bridge) return;
    let canceled = false;
    let first = true;
    const load = async () => {
      if (first) setLoading(true);
      try {
        const next = await bridge.aiActivitySnapshot({ sessionId: selectedId || undefined, includeEvents: true });
        if (canceled) return;
        setSnapshot(next);
        setError("");
        const resolvedId = next.selectedSession?.id || next.activeSessionId || next.sessions[0]?.id || "";
        if (resolvedId && resolvedId !== selectedId) setSelectedId(resolvedId);
      } catch (reason) {
        if (!canceled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!canceled) setLoading(false);
        first = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 900);
    return () => { canceled = true; window.clearInterval(timer); };
  }, [open, bridge, selectedId]);

  if (!open) return null;

  const sessions = snapshot?.sessions ?? [];
  const selected = snapshot?.selectedSession;
  const events = selected?.events ?? [];
  const latestResponseId = [...events].reverse().find((event) => event.type === "response")?.id ?? "";

  return createPortal(<div className="ai-log-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ai-log-overlay" role="dialog" aria-modal="true" aria-labelledby="ai-log-title">
      <header className="ai-log-head">
        <div>
          <small>CANLI AI ÇALIŞMA GÜNLÜĞÜ</small>
          <h2 id="ai-log-title">İstekler, mesajlar ve model cevapları</h2>
          <p>Video çözümleme, Evren Birleştirme ve görsel üretim çağrıları bu uygulama oturumu boyunca burada tutulur.</p>
        </div>
        <div className="ai-log-head-state">
          {snapshot?.activeSessionId && <span><i/>Canlı güncelleniyor</span>}
          <button ref={closeButton} type="button" onClick={onClose} aria-label="AI çalışma günlüğünü kapat">×</button>
        </div>
      </header>

      <div className="ai-log-layout">
        <aside className="ai-log-sessions">
          <header><strong>Çalışmalar</strong><span>{sessions.length}</span></header>
          {sessions.length
            ? <div>{sessions.map((session) => <SessionButton key={session.id} session={session} active={session.id === selectedId} onClick={() => setSelectedId(session.id)}/>)}</div>
            : <p className="ai-log-no-sessions">Henüz bu oturumda bir AI çalışması yapılmadı.</p>}
        </aside>

        <main className="ai-log-detail">
          {selected ? <>
            <section className="ai-log-run-head">
              <div className="ai-log-run-title">
                <small>{kindLabel(selected.kind)} · {stateLabel(selected.state)}</small>
                <h3>{selected.subject || selected.title}</h3>
                <p>{selected.stage}{selected.detail ? ` · ${selected.detail}` : ""}</p>
              </div>
              <div className="ai-log-model-card">
                <small>GERÇEK ÇALIŞAN MODEL</small>
                <code>{selected.model || selected.configuredModel || "Model çağrısı bekleniyor"}</code>
                <span>{selected.provider || "Sağlayıcı bekleniyor"}{selected.fallbackUsed ? " · yedek model kullanıldı" : ""}</span>
              </div>
            </section>

            <section className="ai-log-run-metrics" aria-label="AI çalışma ölçümleri">
              <span><b>{selected.requestCount}</b> istek</span>
              <span><b>{selected.responseCount}</b> cevap</span>
              <span className={selected.errorCount ? "error" : ""}><b>{selected.errorCount}</b> çağrı hatası</span>
              <span><b>{duration(selected.durationMs)}</b> toplam süre</span>
            </section>

            {selected.omittedEventCount > 0 && <div className="ai-log-omitted">Günlük boyut sınırı nedeniyle en eski {selected.omittedEventCount} olay görünümden çıkarıldı.</div>}
            {error && <div className="ai-log-load-error">Canlı günlük yenilenemedi: {error}</div>}
            <section className="ai-log-timeline" aria-live="polite">
              {events.map((event) => <Event key={event.id} event={event} latestResponseId={latestResponseId}/>) }
              {!events.length && <div className="ai-log-empty-detail">{loading ? "Çalışma ayrıntıları yükleniyor…" : "Bu çalışma için henüz günlük olayı yok."}</div>}
            </section>
          </> : <div className="ai-log-empty-detail large">{loading ? "AI çalışma günlüğü yükleniyor…" : "Ayrıntılarını görmek için soldan bir çalışma seç."}{error && <small>{error}</small>}</div>}
        </main>
      </div>
    </section>
  </div>, document.body);
}
