import { useEffect, useMemo, useState } from "react";
import BulkOperations from "./BulkOperations";
import { LegacyRecordDetail, WorkspaceRecordDetail } from "./EditorialRecordDetail";
import EditorialRelationsView from "./EditorialRelationsView";
import EditorialTimelineView from "./EditorialTimelineView";
import SupportRecordsEditor from "./SupportRecordsEditor";

type ViewMode = "editor" | "characters" | "support" | "bulk" | "relations" | "timeline";
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
};
type Selection = { source: "workspace" | "legacy"; key: string };
type WorkspaceStatusMessage = { message: string; tone: "success" | "error" } | null;

type Props = {
  nodes: StudioUniverseWorkspaceNode[];
  legacyItems: LegacyItem[];
  legacyRelations: StudioPersistedRelation[];
  onReload: () => Promise<void>;
  onCreate: () => void;
};

const focusStorageKey = "channel-foundry:editor-focus";
const modeStorageKey = "channel-foundry:editor-mode";
const workspaceLabels: Record<StudioUniverseWorkspaceNode["kind"], string> = {
  story: "Hikâye",
  character: "Muhatap",
  event: "Olay",
  location: "Mekân",
  object: "Nesne",
};
const workspaceShort: Record<StudioUniverseWorkspaceNode["kind"], string> = { story: "HK", character: "MH", event: "OL", location: "MK", object: "NS" };
const legacyLabels: Record<StudioPersistedItem["kind"], string> = { video: "Kayıt", character: "Muhatap", event: "Olay", file: "Dosya" };
const legacyShort: Record<StudioPersistedItem["kind"], string> = { video: "KY", character: "MH", event: "OL", file: "DS" };

function isYoutubeSourceItem(item: LegacyItem) {
  return item.kind === "video" && (item.id.startsWith("youtube-") || item.key.startsWith("video:youtube-"));
}

function sourceVideoId(item: LegacyItem) {
  if (!isYoutubeSourceItem(item)) return "";
  if (item.id.startsWith("youtube-")) return item.id.slice("youtube-".length);
  return item.key.slice("video:youtube-".length);
}

function WorkspaceTabs({ mode, onMode, onCreate, status }: { mode: ViewMode; onMode: (mode: ViewMode) => void; onCreate: () => void; status: WorkspaceStatusMessage }) {
  return <div className="record-tabs"><button className={mode === "editor" ? "active" : ""} onClick={() => onMode("editor")}>Editoryal Evren</button><button className={mode === "characters" ? "active" : ""} onClick={() => onMode("characters")}>Muhataplar</button><button className={`records-support-tab ${mode === "support" ? "active" : ""}`} onClick={() => onMode("support")}>Sponsor & Katkı</button><button className={mode === "bulk" ? "active" : ""} onClick={() => onMode("bulk")}>Toplu İşlemler</button><button className={mode === "relations" ? "active" : ""} onClick={() => onMode("relations")}>İlişkiler</button><button className={mode === "timeline" ? "active" : ""} onClick={() => onMode("timeline")}>Timeline</button><span className={status ? `records-inline-status ${status.tone}` : "records-inline-status"} aria-live="polite">{status?.message ?? ""}</span>{mode !== "support" && <button className="records-create-button" onClick={onCreate}>+ Manuel içerik</button>}</div>;
}

export default function EditorialWorkspaceV2({ nodes, legacyItems, legacyRelations, onReload, onCreate }: Props) {
  const bridge = window.channelFoundryStudio as EditorialBridge | undefined;
  const [mode, setMode] = useState<ViewMode>(() => sessionStorage.getItem(modeStorageKey) === "characters" ? "characters" : "editor");
  const [workspaceRelations, setWorkspaceRelations] = useState<WorkspaceRelation[]>([]);
  const [query, setQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<WorkspaceStatusMessage>(null);
  const characterMode = mode === "characters";
  const approvedNodes = useMemo(() => nodes.filter((node) => node.state === "approved" && (characterMode ? node.kind === "character" : node.kind !== "character")), [nodes, characterMode]);
  const scopedLegacy = useMemo(() => legacyItems.filter((item) => characterMode ? item.kind === "character" : item.kind !== "character"), [legacyItems, characterMode]);
  const sourceLegacy = useMemo(() => scopedLegacy.filter(isYoutubeSourceItem), [scopedLegacy]);
  const manualLegacy = useMemo(() => scopedLegacy.filter((item) => !isYoutubeSourceItem(item)), [scopedLegacy]);
  const uniqueSourceVideos = useMemo(() => {
    const ids = new Set<string>();
    approvedNodes.forEach((node) => node.sourceVideoIds.forEach((id) => ids.add(id)));
    sourceLegacy.forEach((item) => {
      const id = sourceVideoId(item);
      if (id) ids.add(id);
    });
    return ids.size;
  }, [approvedNodes, sourceLegacy]);
  const [selection, setSelection] = useState<Selection | null>(approvedNodes[0] ? { source: "workspace", key: approvedNodes[0].key } : scopedLegacy[0] ? { source: "legacy", key: scopedLegacy[0].key } : null);

  useEffect(() => {
    sessionStorage.removeItem(modeStorageKey);
    const handleMode = (event: Event) => {
      const nextMode = (event as CustomEvent<unknown>).detail;
      if (nextMode !== "editor" && nextMode !== "characters") return;
      sessionStorage.removeItem(modeStorageKey);
      setMode(nextMode);
      setQuery("");
      setStatusMessage(null);
    };
    window.addEventListener("channel-foundry:editor-mode", handleMode);
    return () => window.removeEventListener("channel-foundry:editor-mode", handleMode);
  }, []);

  useEffect(() => {
    if (!bridge) return;
    void bridge.universeWorkspaceRelations({ state: "approved" }).then(setWorkspaceRelations).catch(() => setWorkspaceRelations([]));
  }, [bridge, nodes.length]);

  useEffect(() => {
    const pending = sessionStorage.getItem(focusStorageKey);
    if (!pending) return;
    const workspaceTarget = nodes.find((node) => node.state === "approved" && node.key === pending);
    if (workspaceTarget) {
      setMode(workspaceTarget.kind === "character" ? "characters" : "editor");
      setSelection({ source: "workspace", key: pending });
      setQuery("");
      sessionStorage.removeItem(focusStorageKey);
      return;
    }
    const legacyTarget = legacyItems.find((item) => item.key === pending);
    if (legacyTarget) {
      setMode(legacyTarget.kind === "character" ? "characters" : "editor");
      setSelection({ source: "legacy", key: pending });
      setQuery("");
      sessionStorage.removeItem(focusStorageKey);
    }
  }, [nodes, legacyItems]);

  useEffect(() => {
    if (selection?.source === "workspace" && approvedNodes.some((node) => node.key === selection.key)) return;
    if (selection?.source === "legacy" && scopedLegacy.some((item) => item.key === selection.key)) return;
    setSelection(approvedNodes[0] ? { source: "workspace", key: approvedNodes[0].key } : scopedLegacy[0] ? { source: "legacy", key: scopedLegacy[0].key } : null);
  }, [approvedNodes, scopedLegacy, selection]);

  const openRecord = (source: "workspace" | "legacy", key: string) => {
    const workspaceTarget = source === "workspace" ? nodes.find((node) => node.key === key) : null;
    const legacyTarget = source === "legacy" ? legacyItems.find((item) => item.key === key) : null;
    const targetIsCharacter = workspaceTarget?.kind === "character" || legacyTarget?.kind === "character";
    if (targetIsCharacter !== characterMode) {
      setMode(targetIsCharacter ? "characters" : "editor");
    }
    setSelection({ source, key });
    setQuery("");
    setStatusMessage(null);
  };

  const reportStatus = (message: string | null, tone: "success" | "error" = "success") => {
    setStatusMessage(message ? { message, tone } : null);
  };

  const term = query.trim().toLocaleLowerCase("tr-TR");
  const filteredNodes = approvedNodes.filter((node) => !term || `${node.name} ${node.summary} ${node.aliases.join(" ")}`.toLocaleLowerCase("tr-TR").includes(term));
  const filteredLegacy = scopedLegacy.filter((item) => !term || `${item.title} ${item.meta} ${item.summary}`.toLocaleLowerCase("tr-TR").includes(term));
  const selectedNode = selection?.source === "workspace" ? approvedNodes.find((node) => node.key === selection.key) ?? null : null;
  const selectedLegacy = selection?.source === "legacy" ? scopedLegacy.find((item) => item.key === selection.key) ?? null : null;

  const changeMode = (nextMode: ViewMode) => { setMode(nextMode); setQuery(""); setStatusMessage(null); };

  if (!characterMode && mode === "support") return <div className="editorial-workspace"><WorkspaceTabs mode={mode} onMode={changeMode} onCreate={onCreate} status={statusMessage}/><SupportRecordsEditor onStatus={reportStatus}/></div>;
  if (!characterMode && mode === "bulk") return <div className="editorial-workspace"><WorkspaceTabs mode={mode} onMode={changeMode} onCreate={onCreate} status={statusMessage}/><BulkOperations onStatus={reportStatus}/></div>;
  if (!characterMode && mode === "relations") return <div className="editorial-workspace"><WorkspaceTabs mode={mode} onMode={changeMode} onCreate={onCreate} status={statusMessage}/><EditorialRelationsView nodes={nodes} workspaceRelations={workspaceRelations} legacyItems={legacyItems} legacyRelations={legacyRelations} onOpenRecord={openRecord}/></div>;
  if (!characterMode && mode === "timeline") return <div className="editorial-workspace"><WorkspaceTabs mode={mode} onMode={changeMode} onCreate={onCreate} status={statusMessage}/><EditorialTimelineView nodes={nodes} legacyItems={legacyItems} onOpenRecord={openRecord}/></div>;

  return <div className="editorial-workspace">
    <WorkspaceTabs mode={mode} onMode={changeMode} onCreate={onCreate} status={statusMessage}/>
    <div className="editorial-summary-strip">
      <div><span>ONAYLI EVREN</span><strong>{approvedNodes.length}</strong><small>AI Atölyesi'nden gelen</small></div>
      <div><span>KAYNAK VİDEO</span><strong>{uniqueSourceVideos}</strong><small>onaylı kayıtlarda kullanılan</small></div>
      <div><span>MANUEL</span><strong>{manualLegacy.length}</strong><small>yerel bağımsız kayıt</small></div>
    </div>
    <div className="archive-layout records-layout editorial-layout">
      <section className="archive-browser panel editorial-browser">
        <div className="archive-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={characterMode ? "Muhataplarda ara…" : "Kayıt dosyalarında ara…"}/></div>
        <div className="archive-count">{filteredNodes.length + filteredLegacy.length} içerik · AI onaylı kayıtlar kaynak bilgilerini korur</div>
        <div className="archive-list editorial-list">
          {filteredNodes.map((node) => <button key={node.key} className={selection?.source === "workspace" && selection.key === node.key ? "selected" : ""} onClick={() => { setSelection({ source: "workspace", key: node.key }); setStatusMessage(null); }}><span className="kind-badge">{workspaceShort[node.kind]}</span><span className="archive-row-copy"><strong>{node.name}</strong><small>{workspaceLabels[node.kind]} · {node.sourceVideoIds.length} kaynak video</small></span><span className="editorial-origin ai">AI / Onaylı</span></button>)}
          {filteredLegacy.map((item) => {
            const sourceItem = isYoutubeSourceItem(item);
            return <button key={item.key} className={selection?.source === "legacy" && selection.key === item.key ? "selected" : ""} onClick={() => { setSelection({ source: "legacy", key: item.key }); setStatusMessage(null); }}><span className="kind-badge">{legacyShort[item.kind]}</span><span className="archive-row-copy"><strong>{item.title}</strong><small>{sourceItem ? `YouTube kaynağı · ${item.meta || "tarih yok"}` : `${legacyLabels[item.kind]} · ${item.relatedCount} bağlantı`}</small></span><span className={`editorial-origin ${sourceItem ? "source" : "manual"}`}>{sourceItem ? "Kaynak" : "Manuel"}</span></button>;
          })}
          {!filteredNodes.length && !filteredLegacy.length && <div className="editorial-empty-list">Bu görünümde içerik bulunamadı.</div>}
        </div>
      </section>
      <section className="editor panel editorial-editor record-detail-host">
        {selectedNode ? <WorkspaceRecordDetail node={selectedNode} relations={workspaceRelations} allNodes={nodes} onReload={onReload} onStatus={reportStatus}/>
          : selectedLegacy ? <LegacyRecordDetail item={selectedLegacy} relations={legacyRelations} allItems={legacyItems} onReload={onReload} onStatus={reportStatus}/>
            : <div className="editor-empty"><strong>İçerik seç.</strong></div>}
      </section>
    </div>
  </div>;
}
