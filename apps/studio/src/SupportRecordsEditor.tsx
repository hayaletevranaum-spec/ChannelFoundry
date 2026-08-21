import { useEffect, useMemo, useState } from "react";

type SupportKind = "sponsor" | "contributor";
type SupportRecord = {
  id: string;
  videoId: string;
  kind: SupportKind;
  name: string;
  source: "analysis" | "manual" | "analysis+manual" | string;
};
type SupportSource = {
  videoId: string;
  state: "curated" | "excluded" | string;
  title: string;
  publishedAt: string;
  url: string;
};
type SupportSaveResult = { ok: true; records: SupportRecord[]; sources: SupportSource[] };
type SupportBridge = NonNullable<typeof window.birdesengorStudio> & {
  aiAnalysisSupportRecords(): Promise<SupportRecord[]>;
  aiAnalysisSupportSources(): Promise<SupportSource[]>;
  aiAnalysisSupportSave(input: {
    videoId: string;
    kind: SupportKind;
    originalName?: string;
    name?: string;
    targetVideoId?: string;
    targetKind?: SupportKind;
    delete?: boolean;
  }): Promise<SupportSaveResult>;
};
type Props = { onStatus: (message: string | null, tone?: "success" | "error") => void };
type Draft = { name: string; kind: SupportKind; videoId: string };

const emptyDraft: Draft = { name: "", kind: "sponsor", videoId: "" };
const kindLabel: Record<SupportKind, string> = { sponsor: "Sponsor", contributor: "Katkıda bulunan" };
const kindShort: Record<SupportKind, string> = { sponsor: "SP", contributor: "KT" };

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function formatDate(value: string) {
  if (!value) return "tarih yok";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function originText(value: string) {
  if (value === "analysis") return "AI kaydı";
  if (value === "manual") return "Manuel";
  if (value === "analysis+manual") return "AI + manuel";
  return value || "Kayıt";
}

export default function SupportRecordsEditor({ onStatus }: Props) {
  const bridge = window.birdesengorStudio as SupportBridge | undefined;
  const [records, setRecords] = useState<SupportRecord[]>([]);
  const [sources, setSources] = useState<SupportSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  const choose = (record: SupportRecord | null, nextSources = sources) => {
    if (!record) {
      setSelectedId(null);
      setCreating(false);
      setDraft({ ...emptyDraft, videoId: nextSources[0]?.videoId ?? "" });
      return;
    }
    setCreating(false);
    setSelectedId(record.id);
    setDraft({ name: record.name, kind: record.kind, videoId: record.videoId });
  };

  const applySnapshot = (nextRecords: SupportRecord[], nextSources: SupportSource[], preferred?: { videoId: string; kind: SupportKind; name: string }) => {
    setRecords(nextRecords);
    setSources(nextSources);
    const preferredRecord = preferred
      ? nextRecords.find((record) => record.videoId === preferred.videoId && record.kind === preferred.kind && record.name === preferred.name)
      : null;
    const current = nextRecords.find((record) => record.id === selectedId);
    choose(preferredRecord ?? current ?? nextRecords[0] ?? null, nextSources);
  };

  const load = async () => {
    if (!bridge) return;
    const [nextRecords, nextSources] = await Promise.all([bridge.aiAnalysisSupportRecords(), bridge.aiAnalysisSupportSources()]);
    setRecords(nextRecords);
    setSources(nextSources);
    setSelectedId((current) => current && nextRecords.some((record) => record.id === current) ? current : nextRecords[0]?.id ?? null);
    if (!selectedId && nextRecords[0]) setDraft({ name: nextRecords[0].name, kind: nextRecords[0].kind, videoId: nextRecords[0].videoId });
    else if (!nextRecords.length) setDraft((current) => ({ ...current, videoId: current.videoId || nextSources[0]?.videoId || "" }));
  };

  useEffect(() => {
    void load().catch((reason) => onStatus(errorText(reason), "error"));
    return bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
  }, []);

  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.videoId, source])), [sources]);
  const selected = records.find((record) => record.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected || creating) return;
    setDraft({ name: selected.name, kind: selected.kind, videoId: selected.videoId });
  }, [selected?.id, creating]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("tr-TR");
    return records.filter((record) => {
      const source = sourceMap.get(record.videoId);
      return !term || `${record.name} ${kindLabel[record.kind]} ${source?.title ?? record.videoId}`.toLocaleLowerCase("tr-TR").includes(term);
    });
  }, [records, sourceMap, query]);

  const sponsorCount = records.filter((record) => record.kind === "sponsor").length;
  const contributorCount = records.filter((record) => record.kind === "contributor").length;

  const startCreate = () => {
    setCreating(true);
    setSelectedId(null);
    setDraft({ name: "", kind: "sponsor", videoId: sources[0]?.videoId ?? "" });
    onStatus(null);
  };

  const save = async () => {
    if (!bridge || busy) return;
    const name = draft.name.trim();
    if (!name || !draft.videoId) { onStatus("Ad ve kaynak video gerekli.", "error"); return; }
    setBusy(true);
    try {
      const result = creating
        ? await bridge.aiAnalysisSupportSave({ videoId: draft.videoId, kind: draft.kind, name })
        : selected
          ? await bridge.aiAnalysisSupportSave({
              videoId: selected.videoId,
              kind: selected.kind,
              originalName: selected.name,
              name,
              targetVideoId: draft.videoId,
              targetKind: draft.kind,
            })
          : null;
      if (!result) return;
      applySnapshot(result.records, result.sources, { videoId: draft.videoId, kind: draft.kind, name });
      setCreating(false);
      onStatus(`${kindLabel[draft.kind]} kaydı kaydedildi. Sonraki yayında web'e yansır.`, "success");
    } catch (reason) { onStatus(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!bridge || !selected || busy) return;
    if (!window.confirm(`“${selected.name}” kaydını yayından kaldırmak istiyor musun?`)) return;
    setBusy(true);
    try {
      const result = await bridge.aiAnalysisSupportSave({
        videoId: selected.videoId,
        kind: selected.kind,
        originalName: selected.name,
        delete: true,
      });
      applySnapshot(result.records, result.sources);
      onStatus("Destek kaydı kaldırıldı. Sonraki yayında web'den de kalkar.", "success");
    } catch (reason) { onStatus(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  if (!bridge) return <div className="support-records-empty panel">Sponsor ve katkı kayıtları Electron Studio içinde kullanılabilir.</div>;

  return <div className="support-records-workspace">
    <div className="support-records-metrics">
      <article><span>SPONSOR</span><strong>{sponsorCount}</strong><small>yayına dahil kayıt</small></article>
      <article><span>KATKIDA BULUNAN</span><strong>{contributorCount}</strong><small>yayına dahil kayıt</small></article>
      <article><span>KAYNAK VİDEO</span><strong>{sources.length}</strong><small>ayıklanmış kaynak</small></article>
    </div>

    <div className="support-records-layout">
      <section className="panel support-records-index">
        <header>
          <div><small>DESTEK KAYITLARI</small><strong>Sponsorlar ve katkıda bulunanlar</strong></div>
          <button onClick={startCreate} disabled={!sources.length}>+ Yeni kayıt</button>
        </header>
        <div className="support-records-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ad veya videoda ara…"/></div>
        <div className="support-records-list">
          {filtered.map((record) => {
            const source = sourceMap.get(record.videoId);
            return <button key={record.id} className={!creating && selected?.id === record.id ? "active" : ""} onClick={() => choose(record)}>
              <span className="support-kind-badge">{kindShort[record.kind]}</span>
              <span><strong>{record.name}</strong><small>{source?.title || record.videoId}</small></span>
              <em>{originText(record.source)}</em>
            </button>;
          })}
          {!filtered.length && <div className="support-records-empty">Bu filtrede kayıt yok.</div>}
        </div>
      </section>

      <section className="panel support-records-editor">
        {selected || creating ? <>
          <header>
            <div><small>{creating ? "YENİ DESTEK KAYDI" : "YAYINA DAHİL KAYIT"}</small><h2>{creating ? "Yeni sponsor / katkı kaydı" : selected?.name}</h2></div>
            {!creating && selected && <span className="support-published-state">Yayına dahil</span>}
          </header>
          <div className="support-record-form">
            <label><span>TÜR</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as SupportKind }))}><option value="sponsor">Sponsor</option><option value="contributor">Katkıda bulunan</option></select></label>
            <label><span>AD / GÖRÜNEN İSİM</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Kayıtta görünecek ad"/></label>
            <label><span>KAYNAK VİDEO</span><select value={draft.videoId} onChange={(event) => setDraft((current) => ({ ...current, videoId: event.target.value }))}>{sources.map((source) => <option key={source.videoId} value={source.videoId}>{source.title} · {formatDate(source.publishedAt)}</option>)}</select></label>
          </div>
          <div className="support-record-source-card">
            <small>KAYIT DAVRANIŞI</small>
            <p>Bu kayıt, AI ayıklamasındaki sponsor/katkı bilgisini ezmeden editoryal bir düzeltme olarak saklanır. Kaydettiğinde sonraki Studio yayın paketine otomatik girer.</p>
            {!creating && selected && <span>{originText(selected.source)} · {sourceMap.get(selected.videoId)?.title || selected.videoId}</span>}
          </div>
          <footer>
            {!creating && <button className="danger-text" disabled={busy} onClick={() => void remove()}>Kaydı kaldır</button>}
            {creating && <button className="text-button" disabled={busy} onClick={() => choose(records[0] ?? null)}>Vazgeç</button>}
            <button className="primary-button" disabled={busy || !draft.name.trim() || !draft.videoId} onClick={() => void save()}>{busy ? "Kaydediliyor…" : "Kaydet"}</button>
          </footer>
        </> : <div className="support-records-editor-empty"><strong>Destek kaydı seç.</strong><p>Sponsorlar ve katkıda bulunanlar burada yayından sonra da görünür ve düzenlenebilir.</p>{sources.length > 0 && <button className="primary-button" onClick={startCreate}>Yeni kayıt ekle</button>}</div>}
      </section>
    </div>
  </div>;
}
