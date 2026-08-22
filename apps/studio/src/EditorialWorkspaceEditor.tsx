import { useEffect, useMemo, useState } from "react";
import BulkOperations from "./BulkOperations";
import VisualProfileEditor from "./VisualProfileEditor";

type WorkspaceKind = StudioUniverseWorkspaceNode["kind"];
type ViewMode = "editor" | "bulk" | "relations" | "timeline";
type LegacyItem = StudioPersistedItem & { relatedCount: number };
type WorkspaceRelation = {
  key: string;
  runId: number;
  fromKey: string;
  toKey: string;
  label: string;
  sourceVideoIds: string[];
  state: "draft" | "approved";
  updatedAt: string;
};
type EditorialBridge = NonNullable<typeof window.channelFoundryStudio> & {
  universeWorkspaceRelations(input?: { state?: "draft" | "approved" }): Promise<WorkspaceRelation[]>;
  universeWorkspaceUpdate(input: {
    key: string;
    name: string;
    summary: string;
    aliases: string[];
    state: "draft" | "approved";
    roles?: string[];
    storyNames?: string[];
    characterNames?: string[];
    locationNames?: string[];
    objectNames?: string[];
  }): Promise<StudioUniverseWorkspaceNode>;
};

type Props = {
  nodes: StudioUniverseWorkspaceNode[];
  legacyItems: LegacyItem[];
  legacyRelations: StudioPersistedRelation[];
  onReload: () => Promise<void>;
  characterMode?: boolean;
};

type Selection =
  | { source: "workspace"; key: string }
  | { source: "legacy"; key: string };

const workspaceLabels: Record<WorkspaceKind, string> = {
  story: "Hikâye",
  character: "Muhatap",
  event: "Olay",
  location: "Mekân",
  object: "Nesne",
};
const workspaceShort: Record<WorkspaceKind, string> = { story: "HK", character: "MH", event: "OL", location: "MK", object: "NS" };
const legacyLabels: Record<StudioPersistedItem["kind"], string> = { video: "Kayıt", character: "Muhatap", event: "Olay", file: "Dosya" };
const legacyShort: Record<StudioPersistedItem["kind"], string> = { video: "KY", character: "MH", event: "OL", file: "DS" };

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function lines(value: string) { return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean); }
function payloadArray(node: StudioUniverseWorkspaceNode, field: string) {
  const value = (node.payload as Record<string, unknown> | undefined)?.[field];
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}
function nodeDetails(node: StudioUniverseWorkspaceNode) {
  const payload = node.payload as Record<string, unknown> | undefined;
  const raw = Array.isArray(payload?.details) ? payload?.details : Array.isArray(payload?.sequence) ? payload?.sequence : [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const text = String(record.text ?? "").trim();
    const sourceVideoIds = Array.isArray(record.sourceVideoIds) ? record.sourceVideoIds.map((id) => String(id)) : [];
    return text ? { text, sourceVideoIds } : null;
  }).filter((entry): entry is { text: string; sourceVideoIds: string[] } => Boolean(entry));
}

export default function EditorialWorkspaceEditor({ nodes, legacyItems, legacyRelations, onReload, characterMode = false }: Props) {
  const bridge = window.channelFoundryStudio as EditorialBridge | undefined;
  const [mode, setMode] = useState<ViewMode>("editor");
  const [workspaceRelations, setWorkspaceRelations] = useState<WorkspaceRelation[]>([]);
  const [query, setQuery] = useState("");
  const approvedNodes = useMemo(() => nodes.filter((node) => node.state === "approved" && (characterMode ? node.kind === "character" : node.kind !== "character")), [nodes, characterMode]);
  const scopedLegacy = useMemo(() => legacyItems.filter((item) => characterMode ? item.kind === "character" : item.kind !== "character"), [legacyItems, characterMode]);
  const [selection, setSelection] = useState<Selection | null>(approvedNodes[0] ? { source: "workspace", key: approvedNodes[0].key } : scopedLegacy[0] ? { source: "legacy", key: scopedLegacy[0].key } : null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.universeWorkspaceRelations({ state: "approved" }).then(setWorkspaceRelations).catch(() => setWorkspaceRelations([]));
  }, [nodes.length]);

  useEffect(() => {
    if (selection?.source === "workspace" && approvedNodes.some((node) => node.key === selection.key)) return;
    if (selection?.source === "legacy" && scopedLegacy.some((item) => item.key === selection.key)) return;
    setSelection(approvedNodes[0] ? { source: "workspace", key: approvedNodes[0].key } : scopedLegacy[0] ? { source: "legacy", key: scopedLegacy[0].key } : null);
  }, [approvedNodes.length, scopedLegacy.length, selection?.source, selection?.key]);

  const term = query.trim().toLocaleLowerCase("tr-TR");
  const filteredNodes = approvedNodes.filter((node) => !term || `${node.name} ${node.summary} ${node.aliases.join(" ")}`.toLocaleLowerCase("tr-TR").includes(term));
  const filteredLegacy = scopedLegacy.filter((item) => !term || `${item.title} ${item.meta} ${item.summary}`.toLocaleLowerCase("tr-TR").includes(term));
  const selectedNode = selection?.source === "workspace" ? approvedNodes.find((node) => node.key === selection.key) ?? null : null;
  const selectedLegacy = selection?.source === "legacy" ? scopedLegacy.find((item) => item.key === selection.key) ?? null : null;

  if (!characterMode && mode === "bulk") return <div className="editorial-workspace"><WorkspaceTabs mode={mode} onMode={setMode}/><BulkOperations/></div>;
  if (!characterMode && mode === "relations") return <div className="editorial-workspace"><WorkspaceTabs mode={mode} onMode={setMode}/><RelationsView nodes={nodes} workspaceRelations={workspaceRelations} legacyItems={legacyItems} legacyRelations={legacyRelations}/></div>;
  if (!characterMode && mode === "timeline") return <div className="editorial-workspace"><WorkspaceTabs mode={mode} onMode={setMode}/><TimelineView nodes={nodes} legacyItems={legacyItems}/></div>;

  return <div className="editorial-workspace">
    {!characterMode && <WorkspaceTabs mode={mode} onMode={setMode}/>} 
    <div className="editorial-summary-strip">
      <div><span>ONAYLI EVREN</span><strong>{approvedNodes.length}</strong><small>AI Atölyesi'nden gelen</small></div>
      <div><span>MANUEL</span><strong>{scopedLegacy.length}</strong><small>yerel kayıt</small></div>
      <div><span>KAYNAK</span><strong>{approvedNodes.reduce((total, node) => total + node.sourceVideoIds.length, 0)}</strong><small>video referansı</small></div>
    </div>
    <div className="archive-layout records-layout editorial-layout">
      <section className="archive-browser panel editorial-browser">
        <div className="archive-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={characterMode ? "Muhataplarda ara…" : "Kayıt dosyalarında ara…"}/></div>
        <div className="archive-count">{filteredNodes.length + filteredLegacy.length} içerik · AI onaylı kayıtlar kaynak bilgilerini korur</div>
        <div className="archive-list editorial-list">
          {filteredNodes.map((node) => <button key={node.key} className={selection?.source === "workspace" && selection.key === node.key ? "selected" : ""} onClick={() => setSelection({ source: "workspace", key: node.key })}>
            <span className="kind-badge">{workspaceShort[node.kind]}</span>
            <span className="archive-row-copy"><strong>{node.name}</strong><small>{workspaceLabels[node.kind]} · {node.sourceVideoIds.length} kaynak video</small></span>
            <span className="editorial-origin ai">AI / Onaylı</span>
          </button>)}
          {filteredLegacy.map((item) => <button key={item.key} className={selection?.source === "legacy" && selection.key === item.key ? "selected" : ""} onClick={() => setSelection({ source: "legacy", key: item.key })}>
            <span className="kind-badge">{legacyShort[item.kind]}</span>
            <span className="archive-row-copy"><strong>{item.title}</strong><small>{legacyLabels[item.kind]} · {item.relatedCount} bağlantı</small></span>
            <span className="editorial-origin manual">Manuel</span>
          </button>)}
          {!filteredNodes.length && !filteredLegacy.length && <div className="editorial-empty-list">Bu görünümde içerik bulunamadı.</div>}
        </div>
      </section>
      <section className="editor panel editorial-editor">
        {selectedNode ? <WorkspaceNodeEditor node={selectedNode} relations={workspaceRelations} allNodes={nodes} onReload={onReload}/>
          : selectedLegacy ? <LegacyEditor item={selectedLegacy} relations={legacyRelations} allItems={legacyItems} onReload={onReload}/>
            : <div className="editor-empty"><strong>İçerik seç.</strong></div>}
      </section>
    </div>
  </div>;
}

function WorkspaceTabs({ mode, onMode }: { mode: ViewMode; onMode: (mode: ViewMode) => void }) {
  return <div className="record-tabs"><button className={mode === "editor" ? "active" : ""} onClick={() => onMode("editor")}>Editoryal Evren</button><button className={mode === "bulk" ? "active" : ""} onClick={() => onMode("bulk")}>Toplu İşlemler</button><button className={mode === "relations" ? "active" : ""} onClick={() => onMode("relations")}>İlişkiler</button><button className={mode === "timeline" ? "active" : ""} onClick={() => onMode("timeline")}>Timeline</button></div>;
}

function WorkspaceNodeEditor({ node, relations, allNodes, onReload }: { node: StudioUniverseWorkspaceNode; relations: WorkspaceRelation[]; allNodes: StudioUniverseWorkspaceNode[]; onReload: () => Promise<void> }) {
  const bridge = window.channelFoundryStudio as EditorialBridge | undefined;
  const [name, setName] = useState(node.name);
  const [summary, setSummary] = useState(node.summary);
  const [aliases, setAliases] = useState(node.aliases.join("\n"));
  const [roles, setRoles] = useState(payloadArray(node, "roles").join("\n"));
  const [storyNames, setStoryNames] = useState(payloadArray(node, "storyNames").join("\n"));
  const [state, setState] = useState<"draft" | "approved">(node.state);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(node.name); setSummary(node.summary); setAliases(node.aliases.join("\n")); setRoles(payloadArray(node, "roles").join("\n")); setStoryNames(payloadArray(node, "storyNames").join("\n")); setState(node.state); setNotice(null); setError(null);
  }, [node.key, node.updatedAt]);

  const related = relations.filter((relation) => relation.fromKey === node.key || relation.toKey === node.key).map((relation) => {
    const otherKey = relation.fromKey === node.key ? relation.toKey : relation.fromKey;
    return { relation, other: allNodes.find((entry) => entry.key === otherKey) };
  });
  const details = nodeDetails(node);
  const visual = (node.payload as Record<string, unknown> | undefined)?.visual as StudioVisualDefinition | undefined;

  const save = async () => {
    if (!bridge || busy) return;
    setBusy(true); setNotice(null); setError(null);
    try {
      await bridge.universeWorkspaceUpdate({
        key: node.key,
        name: name.trim() || node.name,
        summary,
        aliases: lines(aliases),
        state,
        roles: lines(roles),
        storyNames: lines(storyNames),
      });
      await onReload();
      setNotice(state === "approved" ? "Editoryal kayıt güncellendi." : "Kayıt incelemeye geri gönderildi.");
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  return <>
    <div className="editor-head editorial-node-head"><div><small>{workspaceLabels[node.kind].toUpperCase()} · AI EVRENİ · {node.sourceVideoIds.length} KAYNAK</small><h2>{node.name}</h2></div><div className="editor-actions">{notice && <span className="save-note visible">{notice}</span>}<button className="primary-button" disabled={busy} onClick={() => void save()}>Kaydet</button></div></div>
    {error && <div className="storage-warning">Kayıt güncellenemedi: {error}</div>}
    <div className="editor-form editorial-node-form">
      <label><span>Başlık / ad</span><input value={name} onChange={(event) => setName(event.target.value)}/></label>
      <div className="form-two"><label><span>Diğer adlar · satır satır</span><textarea value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="Alias veya alternatif ad"/></label><label><span>Durum</span><select value={state} onChange={(event) => setState(event.target.value as "draft" | "approved")}><option value="approved">Onaylı / public adayı</option><option value="draft">İncelemeye geri gönder</option></select></label></div>
      <label><span>Özet</span><textarea className="editorial-summary-input" value={summary} onChange={(event) => setSummary(event.target.value)}/></label>
      {(node.kind === "character" || roles) && <label><span>Rol / tür · satır satır</span><textarea value={roles} onChange={(event) => setRoles(event.target.value)} placeholder="Araştırmacı\nTanık\nVarlık…"/></label>}
      <label><span>Bağlı hikâyeler · satır satır</span><textarea value={storyNames} onChange={(event) => setStoryNames(event.target.value)} placeholder="Hikâye adları"/></label>
    </div>
    <section className="editorial-provenance">
      <div className="relations-head"><div><small>KAYNAK İZİ</small><h3>AI bilgisi kaynağını kaybetmez</h3></div><span>{node.sourceVideoIds.length} video</span></div>
      <div className="source-video-chips">{node.sourceVideoIds.map((videoId) => <span key={videoId}>{videoId}</span>)}{!node.sourceVideoIds.length && <span>Kaynak video kaydı yok.</span>}</div>
      {details.length > 0 && <div className="source-detail-list">{details.slice(0, 12).map((detail, index) => <article key={`${detail.text}:${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><p>{detail.text}</p><small>{detail.sourceVideoIds.length ? `${detail.sourceVideoIds.length} kaynak video` : "Kaynak etiketi yok"}</small></div></article>)}</div>}
    </section>
    <VisualProfileEditor item={{ key: node.key, kind: node.kind, title: node.name }} seedVisual={visual}/>
    <section className="relations-editor editorial-relations"><div className="relations-head"><div><small>İLİŞKİLER</small><h3>Evren bağlantıları</h3></div><span>{related.length} bağlantı</span></div><div className="linked-chips">{related.map(({ relation, other }) => <span key={relation.key}><small>{relation.label}</small>{other?.name || (relation.fromKey === node.key ? relation.toKey : relation.fromKey)}</span>)}{!related.length && <span className="empty-links">Henüz onaylı bağlantı yok.</span>}</div><p className="editorial-help">AI kaynaklı ilişkiler burada kaynak izini korumak için salt okunur gösterilir. İlişki kararı AI Atölyesi'ndeki evren incelemesinden gelir.</p></section>
  </>;
}

function LegacyEditor({ item, relations, allItems, onReload }: { item: LegacyItem; relations: StudioPersistedRelation[]; allItems: LegacyItem[]; onReload: () => Promise<void> }) {
  const bridge = window.channelFoundryStudio;
  const [title, setTitle] = useState(item.title);
  const [meta, setMeta] = useState(item.meta);
  const [summary, setSummary] = useState(item.summary);
  const [status, setStatus] = useState(item.status);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setTitle(item.title); setMeta(item.meta); setSummary(item.summary); setStatus(item.status); setNotice(null); }, [item.key, item.title, item.meta, item.summary, item.status]);
  const linkedKeys = new Set(relations.flatMap((relation) => relation.fromKey === item.key ? [relation.toKey] : relation.toKey === item.key ? [relation.fromKey] : []));
  const linked = allItems.filter((entry) => linkedKeys.has(entry.key));
  const save = async () => { if (!bridge) return; await bridge.saveItem({ ...item, title: title.trim() || item.title, meta, summary, status }); await onReload(); setNotice("Kaydedildi"); };
  const remove = async () => { if (!bridge || !confirm(`“${item.title}” silinsin mi?`)) return; await bridge.deleteItem(item.key); await onReload(); };
  return <>
    <div className="editor-head"><div><small>MANUEL {legacyLabels[item.kind].toUpperCase()} · {item.id}</small><h2>Yerel içerik editörü</h2></div><div className="editor-actions">{notice && <span className="save-note visible">{notice}</span>}<button className="danger-text" onClick={() => void remove()}>Sil</button><button className="primary-button" onClick={() => void save()}>Kaydet</button></div></div>
    <div className="editor-form"><label><span>Başlık</span><input value={title} onChange={(event) => setTitle(event.target.value)}/></label><div className="form-two"><label><span>Bağlam / tarih</span><input value={meta} onChange={(event) => setMeta(event.target.value)}/></label><label><span>Durum</span><select value={status} onChange={(event) => setStatus(event.target.value as StudioPersistedItem["status"])}><option value="draft">Taslak</option><option value="published">Yayında</option></select></label></div><label><span>Özet</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)}/></label></div>
    <VisualProfileEditor item={item}/>
    <section className="relations-editor"><div className="relations-head"><div><small>İLİŞKİLER</small><h3>Manuel bağlantılar</h3></div><span>{linked.length} bağlantı</span></div><div className="linked-chips">{linked.map((entry) => <span key={entry.key}><small>{legacyLabels[entry.kind]}</small>{entry.title}</span>)}{!linked.length && <span className="empty-links">Henüz bağlantı yok.</span>}</div></section>
  </>;
}

function RelationsView({ nodes, workspaceRelations, legacyItems, legacyRelations }: { nodes: StudioUniverseWorkspaceNode[]; workspaceRelations: WorkspaceRelation[]; legacyItems: LegacyItem[]; legacyRelations: StudioPersistedRelation[] }) {
  const nodeMap = new Map(nodes.map((node) => [node.key, node]));
  const itemMap = new Map(legacyItems.map((item) => [item.key, item]));
  return <section className="panel contextual-view editorial-context"><div className="panel-head"><div><small>GELİŞMİŞ GÖRÜNÜM</small><h2>İlişki haritası</h2></div><span>{workspaceRelations.length + legacyRelations.length} bağlantı</span></div><div className="relation-list-simple">
    {workspaceRelations.map((relation) => <div key={relation.key}><span>{nodeMap.get(relation.fromKey)?.name || relation.fromKey}</span><b>{relation.label}</b><span>{nodeMap.get(relation.toKey)?.name || relation.toKey}</span></div>)}
    {legacyRelations.map((relation) => <div key={relation.id}><span>{itemMap.get(relation.fromKey)?.title || relation.fromKey}</span><b>{relation.label}</b><span>{itemMap.get(relation.toKey)?.title || relation.toKey}</span></div>)}
    {!workspaceRelations.length && !legacyRelations.length && <div className="editorial-empty-list">Henüz ilişki yok.</div>}
  </div></section>;
}

function TimelineView({ nodes, legacyItems }: { nodes: StudioUniverseWorkspaceNode[]; legacyItems: LegacyItem[] }) {
  const events = nodes.filter((node) => node.kind === "event" && node.state === "approved");
  const legacyEvents = legacyItems.filter((item) => item.kind === "event");
  return <section className="panel contextual-view editorial-context"><div className="panel-head"><div><small>GELİŞMİŞ GÖRÜNÜM</small><h2>Timeline</h2></div><span>{events.length + legacyEvents.length} olay</span></div><div className="timeline-simple">
    {events.map((node) => <div key={node.key}><span>AI / Onaylı</span><strong>{node.name}</strong><p>{node.summary}</p></div>)}
    {[...legacyEvents].sort((a, b) => a.meta.localeCompare(b.meta)).map((item) => <div key={item.key}><span>{item.meta || "Tarih yok"}</span><strong>{item.title}</strong><p>{item.summary}</p></div>)}
  </div></section>;
}
