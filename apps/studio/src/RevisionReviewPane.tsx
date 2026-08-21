import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";
import { useVideoSourceCatalog, videoSourceTitle } from "./video-source-labels";

type RevisionState = "pending" | "applied" | "dismissed";
type RevisionFilter = "all" | RevisionState;
type UniverseRevision = {
  id: number;
  nodeKey: string;
  runId: number;
  baseRunId: number;
  state: RevisionState;
  diff: string[];
  proposed: {
    name: string;
    summary: string;
    aliases: string[];
    sourceVideoIds: string[];
    payload: Record<string, unknown>;
  };
  createdAt: string;
  reviewedAt: string | null;
};
type UniverseHistoryEntry = {
  id: number;
  nodeKey: string;
  runId: number;
  event: string;
  note: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
};
type RevisionBridge = {
  universeWorkspaceList(input?: Record<string, unknown>): Promise<unknown[]>;
  universeWorkspaceUpdate(input: Record<string, unknown>): Promise<unknown>;
  onDataChanged?(callback: () => void): () => void;
};
type DiffRow = { key: string; label: string; current: ReactNode; proposed: ReactNode };

const kindLabel: Record<StudioUniverseWorkspaceNode["kind"], string> = {
  story: "Hikâye",
  character: "Muhatap",
  event: "Olay",
  location: "Mekân",
  object: "Nesne",
};
const payloadLabels: Record<string, string> = {
  roles: "Rol / tür",
  storyNames: "Bağlı hikâyeler",
  characterNames: "Bağlı muhataplar",
  locationNames: "Bağlı mekânlar",
  objectNames: "Bağlı nesneler",
  details: "Kaynaklı ayrıntılar",
  sequence: "Hikâye akışı",
  visual: "Görsel tanım",
};
const historyLabels: Record<string, string> = {
  approved: "Kayıt onaylandı",
  drafted: "Kayıt yeniden incelemeye alındı",
  editorial_update: "Editoryal düzenleme yapıldı",
  revision_proposed: "Revizyon önerildi",
  revision_applied: "Revizyon uygulandı",
  revision_dismissed: "Mevcut kayıt korundu",
};

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
function equal(a: unknown, b: unknown) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
function textList(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}
function detailTexts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry.trim();
    if (!entry || typeof entry !== "object") return "";
    return String((entry as Record<string, unknown>).text ?? "").trim();
  }).filter(Boolean);
}
function compactVisual(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const visual = value as Record<string, unknown>;
  return [
    String(visual.description ?? "").trim(),
    String(visual.atmosphere ?? "").trim(),
    ...textList(visual.attributes),
  ].filter(Boolean);
}
function ValueBlock({ value, empty = "Yok" }: { value: unknown; empty?: string }) {
  const lines = Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value ?? "")];
  const visible = lines.filter((entry) => entry.trim());
  return <div className={!visible.length ? "revision-value empty" : "revision-value"}>{visible.length ? visible.map((entry, index) => <span key={`${entry}:${index}`}>{entry}</span>) : <span>{empty}</span>}</div>;
}
function payloadValue(key: string, value: unknown) {
  if (key === "details" || key === "sequence") return detailTexts(value);
  if (key === "visual") return compactVisual(value);
  if (Array.isArray(value)) return value.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry));
  if (value && typeof value === "object") return [JSON.stringify(value)];
  return value == null ? [] : [String(value)];
}
function buildDiffRows(current: StudioUniverseWorkspaceNode | null, revision: UniverseRevision, sourceTitle: (videoId: string) => string): DiffRow[] {
  if (!current) return [];
  const rows: DiffRow[] = [];
  const push = (key: string, label: string, before: unknown, after: unknown) => {
    if (equal(before, after)) return;
    rows.push({ key, label, current: <ValueBlock value={before}/>, proposed: <ValueBlock value={after}/> });
  };
  if (revision.diff.includes("name")) push("name", "Kayıt adı", current.name, revision.proposed.name);
  if (revision.diff.includes("summary")) push("summary", "Özet", current.summary, revision.proposed.summary);
  if (revision.diff.includes("aliases")) push("aliases", "Diğer adlar", current.aliases, revision.proposed.aliases);
  if (revision.diff.includes("sources")) push("sources", "Kaynak videolar", current.sourceVideoIds.map(sourceTitle), revision.proposed.sourceVideoIds.map(sourceTitle));
  if (revision.diff.includes("payload")) {
    const before = current.payload && typeof current.payload === "object" ? current.payload as Record<string, unknown> : {};
    const after = revision.proposed.payload && typeof revision.proposed.payload === "object" ? revision.proposed.payload : {};
    const ignored = new Set(["name", "summary", "aliases", "sourceVideoIds"]);
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !ignored.has(key));
    for (const key of keys) {
      if (equal(before[key], after[key])) continue;
      rows.push({
        key: `payload:${key}`,
        label: payloadLabels[key] ?? `Kayıt alanı · ${key}`,
        current: <ValueBlock value={payloadValue(key, before[key])}/>,
        proposed: <ValueBlock value={payloadValue(key, after[key])}/>,
      });
    }
    if (!keys.length && !equal(before, after)) {
      rows.push({ key: "payload", label: "Yapısal kayıt içeriği", current: <ValueBlock value="Mevcut yapı"/>, proposed: <ValueBlock value="Yeni yapı önerisi"/> });
    }
  }
  return rows;
}

export default function RevisionReviewPane() {
  const bridge = window.birdesengorStudio as unknown as RevisionBridge | undefined;
  const notify = useAiWorkbenchNotice();
  const videoCatalog = useVideoSourceCatalog();
  const [revisions, setRevisions] = useState<UniverseRevision[]>([]);
  const [nodes, setNodes] = useState<StudioUniverseWorkspaceNode[]>([]);
  const [history, setHistory] = useState<UniverseHistoryEntry[]>([]);
  const [filter, setFilter] = useState<RevisionFilter>("pending");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    const [revisionRows, nodeRows] = await Promise.all([
      bridge.universeWorkspaceList({ view: "revisions" }),
      bridge.universeWorkspaceList(),
    ]);
    const nextRevisions = revisionRows as UniverseRevision[];
    const nextNodes = nodeRows as StudioUniverseWorkspaceNode[];
    setRevisions(nextRevisions);
    setNodes(nextNodes);
    setSelectedId((current) => current && nextRevisions.some((entry) => entry.id === current)
      ? current
      : nextRevisions.find((entry) => entry.state === "pending")?.id ?? nextRevisions[0]?.id ?? null);
  };

  useEffect(() => {
    void load().catch((reason) => notify(errorText(reason), "error"));
    return bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("tr-TR");
    return revisions.filter((revision) => {
      if (filter !== "all" && revision.state !== filter) return false;
      const node = nodes.find((entry) => entry.key === revision.nodeKey);
      if (term && !`${node?.name ?? revision.proposed.name} ${node?.summary ?? ""} ${revision.proposed.summary}`.toLocaleLowerCase("tr-TR").includes(term)) return false;
      return true;
    });
  }, [revisions, nodes, filter, query]);

  const selected = revisions.find((entry) => entry.id === selectedId) ?? filtered[0] ?? null;
  const currentNode = selected ? nodes.find((entry) => entry.key === selected.nodeKey) ?? null : null;
  const diffRows = selected ? buildDiffRows(currentNode, selected, (videoId) => videoSourceTitle(videoId, videoCatalog)) : [];

  useEffect(() => {
    if (selected && filtered.some((entry) => entry.id === selected.id)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered.length, filter, query]);

  useEffect(() => {
    if (!bridge || !selected?.nodeKey) { setHistory([]); return; }
    void bridge.universeWorkspaceList({ view: "history", nodeKey: selected.nodeKey })
      .then((rows) => setHistory(rows as UniverseHistoryEntry[]))
      .catch((reason) => notify(errorText(reason), "error"));
  }, [bridge, selected?.nodeKey, selected?.id]);

  const decide = async (action: "apply" | "dismiss") => {
    if (!bridge || !selected || selected.state !== "pending" || busy) return;
    const label = currentNode?.name || selected.proposed.name || selected.nodeKey;
    const confirmed = action === "apply"
      ? confirm(`“${label}” kaydı için önerilen ${Math.max(1, diffRows.length)} değişiklik uygulansın mı? Kayıt onaylı kalacak ve karar Kayıt Hafızası'na yazılacak.`)
      : confirm(`“${label}” için bu revizyon reddedilsin ve mevcut onaylı kayıt korunsun mu? Karar Kayıt Hafızası'na yazılacak.`);
    if (!confirmed) return;
    setBusy(true);
    try {
      await bridge.universeWorkspaceUpdate({ action: action === "apply" ? "apply-revision" : "dismiss-revision", id: selected.id });
      await load();
      notify(action === "apply" ? "Revizyon uygulandı; onaylı kayıt güncellendi ve geçmiş korundu." : "Mevcut kayıt korundu; revizyon kararı geçmişe yazıldı.", "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  if (!bridge) return <div className="revision-review-empty panel">Revizyon inceleme Electron Studio içinde kullanılabilir.</div>;

  return <div className="revision-review-pane">
    <div className="revision-review-layout">
      <section className="panel revision-review-list">
        <div className="revision-review-toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Revizyonlarda ara…"/>
          <select value={filter} onChange={(event) => setFilter(event.target.value as RevisionFilter)}>
            <option value="pending">Karar bekleyen</option>
            <option value="applied">Uygulanan</option>
            <option value="dismissed">Korunan kayıtlar</option>
            <option value="all">Tüm revizyonlar</option>
          </select>
        </div>
        <header><span>{filtered.length} revizyon</span><small>KAYIT DEĞİŞİKLİKLERİ</small></header>
        <div className="revision-review-list-rows">
          {filtered.map((revision) => {
            const node = nodes.find((entry) => entry.key === revision.nodeKey);
            return <button key={revision.id} className={selected?.id === revision.id ? "active" : ""} onClick={() => setSelectedId(revision.id)}>
              <span className="revision-run">#{revision.runId}</span>
              <div><strong>{node?.name || revision.proposed.name || "Adsız kayıt"}</strong><small>{node ? kindLabel[node.kind] : "Evren kaydı"} · {revision.diff.length} değişiklik alanı · {date(revision.createdAt)}</small></div>
              <em className={revision.state}>{revision.state === "pending" ? "Karar bekliyor" : revision.state === "applied" ? "Uygulandı" : "Mevcut korundu"}</em>
            </button>;
          })}
          {!filtered.length && <p className="revision-review-list-empty">Bu görünümde revizyon yok.</p>}
        </div>
      </section>

      <section className="panel revision-review-detail">
        {selected ? <>
          <header>
            <div><small>{currentNode ? kindLabel[currentNode.kind].toUpperCase() : "EVREN KAYDI"} · ÇALIŞMA #{selected.runId}</small><h3>{currentNode?.name || selected.proposed.name || "Adsız kayıt"}</h3><p>Onaylı kayıt çalışma #{selected.baseRunId || "—"} temel alınarak korunuyor.</p></div>
            <div className="revision-decision">
              <span className={`revision-state ${selected.state}`}>{selected.state === "pending" ? "Karar bekliyor" : selected.state === "applied" ? "Uygulandı" : "Mevcut kayıt korundu"}</span>
              {selected.state === "pending" && <><button className="secondary-button" disabled={busy} onClick={() => void decide("dismiss")}>Mevcut kaydı koru</button><button className="primary-button" disabled={busy} onClick={() => void decide("apply")}>Revizyonu kabul et</button></>}
            </div>
          </header>

          <section className="revision-change-summary">
            <small>DEĞİŞİKLİK ÖZETİ</small>
            <p>Yalnız değişen alanlar gösteriliyor. AI önerisi doğrudan onaylı kaydı değiştirmez; editoryal karar verilene kadar ayrı bir revizyon olarak bekler.</p>
            <div>{diffRows.map((row) => <span key={row.key}>{row.label}</span>)}</div>
          </section>

          <section className="revision-diff-section">
            <small>DEĞİŞEN ALANLAR · {diffRows.length}</small>
            <div className="revision-diff-list">
              {diffRows.map((row) => <article key={row.key} className="revision-diff-row">
                <h4>{row.label}</h4>
                <div><div><small>MEVCUT KAYIT</small>{row.current}</div><div><small>ÖNERİLEN REVİZYON</small>{row.proposed}</div></div>
              </article>)}
              {!diffRows.length && <p className="revision-diff-empty">Bu revizyon için gösterilebilir alan farkı bulunamadı.</p>}
            </div>
          </section>

          <section className="record-memory-section">
            <div className="record-memory-heading"><div><small>KAYIT HAFIZASI</small><strong>Bu kayıt hangi kararlardan geçti?</strong></div><span>{history.length} hareket</span></div>
            <ol className="record-memory-timeline">
              {history.map((entry) => <li key={entry.id}><i/><div><strong>{historyLabels[entry.event] ?? entry.event}</strong><p>{entry.note || "Editoryal hareket kaydedildi."}</p><small>{date(entry.createdAt)}{entry.runId ? ` · çalışma #${entry.runId}` : ""}</small></div></li>)}
              {!history.length && <li className="empty"><div><strong>Henüz kayıtlı hareket yok.</strong><p>Bu kayıt üzerinde editoryal karar oluştuğunda burada görünecek.</p></div></li>}
            </ol>
          </section>
        </> : <div className="revision-review-detail-empty">İncelemek için bir revizyon kaydı seç.</div>}
      </section>
    </div>
  </div>;
}
