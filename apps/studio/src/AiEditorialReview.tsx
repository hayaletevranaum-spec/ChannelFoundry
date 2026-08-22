import { useEffect, useMemo, useState } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";
import VisualPromptCard from "./VisualPromptCard";
import { useVideoSourceCatalog, videoSourceTitle } from "./video-source-labels";

type KindFilter = "all" | StudioUniverseWorkspaceNode["kind"];
type StateFilter = "all" | StudioUniverseWorkspaceState;

type ReviewBridge = NonNullable<typeof window.channelFoundryStudio> & {
  universeWorkspaceList(input?: { kind?: StudioUniverseWorkspaceNode["kind"]; state?: StudioUniverseWorkspaceState }): Promise<StudioUniverseWorkspaceNode[]>;
  universeWorkspaceSetState(input: { keys: string[]; state: StudioUniverseWorkspaceState }): Promise<StudioUniverseWorkspaceStatus>;
};

const kindLabel: Record<StudioUniverseWorkspaceNode["kind"], string> = {
  story: "Hikâye",
  character: "Muhatap",
  event: "Olay",
  location: "Mekân",
  object: "Nesne",
};
const kindShort: Record<StudioUniverseWorkspaceNode["kind"], string> = {
  story: "HK", character: "MH", event: "OL", location: "MK", object: "NS",
};

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function payloadArray(node: StudioUniverseWorkspaceNode, key: string) {
  const value = (node.payload as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}
function details(node: StudioUniverseWorkspaceNode) {
  const payload = node.payload as Record<string, unknown> | undefined;
  const raw = Array.isArray(payload?.details) ? payload.details : Array.isArray(payload?.sequence) ? payload.sequence : [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const text = String(record.text ?? "").trim();
    return text ? { text, sources: Array.isArray(record.sourceVideoIds) ? record.sourceVideoIds.length : 0 } : null;
  }).filter((entry): entry is { text: string; sources: number } => Boolean(entry));
}
function mergedVisual(node: StudioUniverseWorkspaceNode): StudioVisualDefinition {
  const payload = node.payload as Record<string, unknown> | undefined;
  const raw = payload?.visual && typeof payload.visual === "object" && !Array.isArray(payload.visual)
    ? payload.visual as Record<string, unknown>
    : {};
  return {
    description: String(raw.description ?? "").trim(),
    attributes: Array.isArray(raw.attributes) ? raw.attributes.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [],
    atmosphere: String(raw.atmosphere ?? "").trim(),
    prompt: String(raw.prompt ?? "").trim(),
    negativePrompt: String(raw.negativePrompt ?? "").trim(),
  };
}

export default function AiEditorialReview() {
  const bridge = window.channelFoundryStudio as ReviewBridge | undefined;
  const notify = useAiWorkbenchNotice();
  const videoCatalog = useVideoSourceCatalog();
  const [nodes, setNodes] = useState<StudioUniverseWorkspaceNode[]>([]);
  const [kind, setKind] = useState<KindFilter>("all");
  const [state, setState] = useState<StateFilter>("draft");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    const nextNodes = await bridge.universeWorkspaceList();
    setNodes(nextNodes);
    setSelectedKey((current) => current && nextNodes.some((node) => node.key === current) ? current : nextNodes.find((node) => node.state === "draft")?.key ?? nextNodes[0]?.key ?? null);
  };

  useEffect(() => {
    void load().catch((reason) => notify(errorText(reason), "error"));
    return bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("tr-TR");
    return nodes.filter((node) => {
      if (kind !== "all" && node.kind !== kind) return false;
      if (state !== "all" && node.state !== state) return false;
      if (term && !`${node.name} ${node.summary} ${node.aliases.join(" ")}`.toLocaleLowerCase("tr-TR").includes(term)) return false;
      return true;
    });
  }, [nodes, kind, state, query]);
  const selected = nodes.find((node) => node.key === selectedKey) ?? filtered[0] ?? null;

  useEffect(() => {
    if (selected && filtered.some((node) => node.key === selected.key)) return;
    setSelectedKey(filtered[0]?.key ?? null);
  }, [filtered.length, kind, state, query]);

  const changeState = async (keys: string[], nextState: StudioUniverseWorkspaceState) => {
    if (!bridge || !keys.length || busy) return;
    setBusy(true);
    try {
      await bridge.universeWorkspaceSetState({ keys, state: nextState });
      await load();
      notify(`${keys.length} kayıt ${nextState === "approved" ? "onaylandı" : "incelemeye geri alındı"}.`, "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  if (!bridge) return <div className="ai-review-empty panel">Editoryal inceleme Electron Studio içinde kullanılabilir.</div>;

  const selectedDetails = selected ? details(selected) : [];
  const selectedVisual = selected ? mergedVisual(selected) : null;
  const contextGroups = selected ? [
    ["Hikâyeler", payloadArray(selected, "storyNames")],
    ["Muhataplar", payloadArray(selected, "characterNames")],
    ["Mekânlar", payloadArray(selected, "locationNames")],
    ["Nesneler", payloadArray(selected, "objectNames")],
  ].filter(([, values]) => (values as string[]).length) as Array<[string, string[]]> : [];

  return <div className="ai-editorial-review">
    <div className="ai-review-layout">
      <section className="panel ai-review-list">
        <div className="ai-review-toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Adaylarda ara…"/>
          <select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}><option value="all">Tüm türler</option><option value="story">Hikâyeler</option><option value="character">Muhataplar</option><option value="event">Olaylar</option><option value="location">Mekânlar</option><option value="object">Nesneler</option></select>
          <select value={state} onChange={(event) => setState(event.target.value as StateFilter)}><option value="draft">İnceleme bekleyen</option><option value="approved">Onaylı</option><option value="all">Tüm durumlar</option></select>
          <button className="secondary-button" disabled={busy || !filtered.length} onClick={() => void changeState(filtered.map((node) => node.key), state === "approved" ? "draft" : "approved")}>{state === "approved" ? "Görünenleri taslağa çek" : "Görünenleri onayla"}</button>
        </div>
        <header><span>{filtered.length} kayıt</span><small>AI EVRENİ</small></header>
        <div>{filtered.map((node) => <button key={node.key} className={selected?.key === node.key ? "active" : ""} onClick={() => setSelectedKey(node.key)}><span className="kind-badge">{kindShort[node.kind]}</span><div><strong>{node.name}</strong><small>{kindLabel[node.kind]} · {node.sourceVideoIds.length} kaynak video</small></div><em className={node.state}>{node.state === "approved" ? "Onaylı" : "İncele"}</em></button>)}{!filtered.length && <p className="ai-review-list-empty">Bu filtrede kayıt yok.</p>}</div>
      </section>

      <section className="panel ai-review-detail">
        {selected ? <>
          <header><div><small>{kindLabel[selected.kind].toUpperCase()} · {selected.sourceVideoIds.length} KAYNAK</small><h3>{selected.name}</h3>{selected.aliases.length > 0 && <p>{selected.aliases.join(" · ")}</p>}</div><div><span className={`ai-review-state ${selected.state}`}>{selected.state === "approved" ? "Onaylı" : "İnceleme bekliyor"}</span><button className={selected.state === "draft" ? "primary-button" : "secondary-button"} disabled={busy} onClick={() => void changeState([selected.key], selected.state === "draft" ? "approved" : "draft")}>{selected.state === "draft" ? "Onayla" : "Taslağa çek"}</button></div></header>
          <article className="ai-review-summary"><small>ÖZET</small><p>{selected.summary || "Özet bulunmuyor."}</p></article>
          {selectedVisual && <section className="ai-review-visual-section"><small>GÖRSEL KİMLİK / ÜRETİM GİRDİSİ</small><p className="ai-review-visual-note">Burada yalnız biriken görsel bilgi kontrol edilir. Görsel üretimi ve dosya yönetimi 06 · Görsel Tamamlama aşamasındadır.</p><VisualPromptCard entityKey={selected.key} entityType={`universe-${selected.kind}`} source="universe-merge" title={selected.name} visual={selectedVisual}/></section>}
          {payloadArray(selected, "roles").length > 0 && <section><small>ROL / TÜR</small><div className="ai-review-chips">{payloadArray(selected, "roles").map((entry) => <span key={entry}>{entry}</span>)}</div></section>}
          {contextGroups.length > 0 && <section><small>BAĞLAM</small><div className="ai-review-context">{contextGroups.map(([label, values]) => <div key={label}><b>{label}</b>{values.map((entry) => <span key={entry}>{entry}</span>)}</div>)}</div></section>}
          {selectedDetails.length > 0 && <section><small>{selected.kind === "story" ? "AKIŞ" : "KAYNAKLI AYRINTILAR"}</small><ol className="ai-review-details">{selectedDetails.slice(0, 14).map((entry, index) => <li key={`${entry.text}:${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div>{entry.text}<small>{entry.sources ? `${entry.sources} kaynak video` : "Kaynak etiketi yok"}</small></div></li>)}</ol></section>}
          <footer><div><small>KAYNAK VİDEOLAR</small><div className="ai-review-source-ids">{selected.sourceVideoIds.map((id) => <code key={id} title={`Video kimliği: ${id}`}>{videoSourceTitle(id, videoCatalog)}</code>)}</div></div><button className="text-button" onClick={() => void bridge.navigate(selected.kind === "character" ? "Muhataplar" : "Kayıt Dosyaları")}>Ayrıntılı editöre aç →</button></footer>
        </> : <div className="ai-review-detail-empty">İncelemek için bir evren adayı seç.</div>}
      </section>
    </div>
  </div>;
}
