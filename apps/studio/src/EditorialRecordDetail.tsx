import { useEffect, useMemo, useState } from "react";
import VisualProfileEditor from "./VisualProfileEditor";
import { useVideoSourceCatalog, videoSourceTitle, videoSourceTitles } from "./video-source-labels";

type WorkspaceKind = StudioUniverseWorkspaceNode["kind"];
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
type LegacyItem = StudioPersistedItem & { relatedCount: number };
type EditorialBridge = NonNullable<typeof window.birdesengorStudio> & {
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
type DetailTab = "general" | "context" | "relations" | "sources" | "visual";
type LegacyTab = "general" | "relations" | "visual";

type WorkspaceProps = {
  node: StudioUniverseWorkspaceNode;
  relations: WorkspaceRelation[];
  allNodes: StudioUniverseWorkspaceNode[];
  onReload: () => Promise<void>;
  onStatus?: (message: string | null, tone?: "success" | "error") => void;
};
type LegacyProps = {
  item: LegacyItem;
  relations: StudioPersistedRelation[];
  allItems: LegacyItem[];
  onReload: () => Promise<void>;
  onStatus?: (message: string | null, tone?: "success" | "error") => void;
};

const workspaceLabels: Record<WorkspaceKind, string> = {
  story: "Hikâye",
  character: "Muhatap",
  event: "Olay",
  location: "Mekân",
  object: "Nesne",
};
const legacyLabels: Record<StudioPersistedItem["kind"], string> = {
  video: "Kayıt",
  character: "Muhatap",
  event: "Olay",
  file: "Dosya",
};

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function lines(value: string) { return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean); }
function payloadArray(node: StudioUniverseWorkspaceNode, field: string) {
  const value = (node.payload as Record<string, unknown> | undefined)?.[field];
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}
function detailList(node: StudioUniverseWorkspaceNode, field: "details" | "sequence") {
  const payload = node.payload as Record<string, unknown> | undefined;
  const raw = Array.isArray(payload?.[field]) ? payload?.[field] : [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const text = String(record.text ?? "").trim();
    const sourceVideoIds = Array.isArray(record.sourceVideoIds) ? record.sourceVideoIds.map((id) => String(id)) : [];
    return text ? { text, sourceVideoIds } : null;
  }).filter((entry): entry is { text: string; sourceVideoIds: string[] } => Boolean(entry));
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "—" : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function DetailTabs({ active, onChange, node, relationCount }: { active: DetailTab; onChange: (tab: DetailTab) => void; node: StudioUniverseWorkspaceNode; relationCount: number }) {
  const sequenceCount = detailList(node, "sequence").length || detailList(node, "details").length;
  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: "general", label: "Genel" },
    { id: "context", label: node.kind === "story" ? "Hikâye / Akış" : "Bağlam", count: sequenceCount },
    { id: "relations", label: "İlişkiler", count: relationCount },
    { id: "sources", label: "Kaynaklar", count: node.sourceVideoIds.length },
    { id: "visual", label: "Görsel Profil" },
  ];
  return <nav className="record-detail-tabs" aria-label="Kayıt detay bölümleri">{tabs.map((tab) => <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => onChange(tab.id)}><span>{tab.label}</span>{typeof tab.count === "number" && <b>{tab.count}</b>}</button>)}</nav>;
}

function ArrayField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label><span>{label}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/></label>;
}

export function WorkspaceRecordDetail({ node, relations, allNodes, onReload, onStatus }: WorkspaceProps) {
  const bridge = window.birdesengorStudio as EditorialBridge | undefined;
  const videoCatalog = useVideoSourceCatalog();
  const [tab, setTab] = useState<DetailTab>("general");
  const [name, setName] = useState(node.name);
  const [summary, setSummary] = useState(node.summary);
  const [aliases, setAliases] = useState(node.aliases.join("\n"));
  const [roles, setRoles] = useState(payloadArray(node, "roles").join("\n"));
  const [storyNames, setStoryNames] = useState(payloadArray(node, "storyNames").join("\n"));
  const [characterNames, setCharacterNames] = useState(payloadArray(node, "characterNames").join("\n"));
  const [locationNames, setLocationNames] = useState(payloadArray(node, "locationNames").join("\n"));
  const [objectNames, setObjectNames] = useState(payloadArray(node, "objectNames").join("\n"));
  const [state, setState] = useState<"draft" | "approved">(node.state);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab("general");
    setName(node.name);
    setSummary(node.summary);
    setAliases(node.aliases.join("\n"));
    setRoles(payloadArray(node, "roles").join("\n"));
    setStoryNames(payloadArray(node, "storyNames").join("\n"));
    setCharacterNames(payloadArray(node, "characterNames").join("\n"));
    setLocationNames(payloadArray(node, "locationNames").join("\n"));
    setObjectNames(payloadArray(node, "objectNames").join("\n"));
    setState(node.state);
  }, [node.key, node.updatedAt]);

  const related = useMemo(() => relations.filter((relation) => relation.fromKey === node.key || relation.toKey === node.key).map((relation) => {
    const otherKey = relation.fromKey === node.key ? relation.toKey : relation.fromKey;
    return { relation, other: allNodes.find((entry) => entry.key === otherKey) };
  }), [relations, node.key, allNodes]);
  const sequence = detailList(node, "sequence");
  const details = detailList(node, "details");
  const visibleDetails = sequence.length ? sequence : details;
  const visual = (node.payload as Record<string, unknown> | undefined)?.visual as StudioVisualDefinition | undefined;

  const save = async () => {
    if (!bridge || busy) return;
    setBusy(true); onStatus?.(null);
    try {
      await bridge.universeWorkspaceUpdate({
        key: node.key,
        name: name.trim() || node.name,
        summary,
        aliases: lines(aliases),
        state,
        roles: lines(roles),
        storyNames: lines(storyNames),
        characterNames: lines(characterNames),
        locationNames: lines(locationNames),
        objectNames: lines(objectNames),
      });
      await onReload();
      onStatus?.(state === "approved" ? "Editoryal kayıt güncellendi." : "Kayıt incelemeye geri gönderildi.", "success");
    } catch (reason) { onStatus?.(`Kayıt güncellenemedi: ${errorText(reason)}`, "error"); }
    finally { setBusy(false); }
  };

  return <div className="record-detail-shell">
    <header className="record-detail-head">
      <div className="record-detail-title"><small>{workspaceLabels[node.kind].toUpperCase()} · AI EVRENİ</small><h2>{node.name}</h2><div className="record-detail-facts"><span>{node.sourceVideoIds.length} kaynak</span><span>{related.length} ilişki</span><span>Güncelleme {formatDate(node.updatedAt)}</span></div></div>
      <div className="editor-actions"><button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? "Kaydediliyor…" : "Kaydet"}</button></div>
    </header>
    <DetailTabs active={tab} onChange={setTab} node={node} relationCount={related.length}/>

    <div className="record-detail-body">
      {tab === "general" && <section className="record-detail-section">
        <div className="record-section-heading"><div><small>KİMLİK VE ÖZET</small><h3>Public kaydın temel anlatımı</h3></div><span className={state === "approved" ? "detail-state approved" : "detail-state"}>{state === "approved" ? "Onaylı / public adayı" : "İncelemede"}</span></div>
        <div className="editor-form record-general-form">
          <label><span>Başlık / ad</span><input value={name} onChange={(event) => setName(event.target.value)}/></label>
          <div className="form-two"><ArrayField label="Diğer adlar · satır satır" value={aliases} onChange={setAliases} placeholder="Alias veya alternatif ad"/><label><span>Durum</span><select value={state} onChange={(event) => setState(event.target.value as "draft" | "approved")}><option value="approved">Onaylı / public adayı</option><option value="draft">İncelemeye geri gönder</option></select></label></div>
          <label><span>Özet</span><textarea className="record-summary-input" value={summary} onChange={(event) => setSummary(event.target.value)}/></label>
          {node.kind === "character" && <ArrayField label="Rol / tür · satır satır" value={roles} onChange={setRoles} placeholder={"Araştırmacı\nTanık\nVarlık…"}/>} 
        </div>
        <aside className="record-ai-note"><span>AI KAYNAĞI</span><p>Bu kayıt Evren Birleştirme sonucundan geldi. Burada yaptığın onaylı düzenlemeler sonraki AI birleştirmelerinde korunur.</p></aside>
      </section>}

      {tab === "context" && <section className="record-detail-section">
        <div className="record-section-heading"><div><small>{node.kind === "story" ? "ANLATI AKIŞI" : "EVREN BAĞLAMI"}</small><h3>{node.kind === "story" ? "Hikâyenin sıralı iskeleti" : "Bu kaydın hikâyedeki yeri"}</h3></div><span>{visibleDetails.length} kaynaklı not</span></div>
        <div className="record-context-grid">
          <div className="record-context-fields">
            <ArrayField label="Bağlı hikâyeler · satır satır" value={storyNames} onChange={setStoryNames} placeholder="Hikâye adları"/>
            {node.kind !== "character" && <ArrayField label="Muhataplar · satır satır" value={characterNames} onChange={setCharacterNames} placeholder="Karakter / muhatap adları"/>}
            <ArrayField label="Mekânlar · satır satır" value={locationNames} onChange={setLocationNames} placeholder="Mekân adları"/>
            <ArrayField label="Nesneler · satır satır" value={objectNames} onChange={setObjectNames} placeholder="Nesne adları"/>
          </div>
          <div className="record-sequence">
            {visibleDetails.map((detail, index) => <article key={`${detail.text}:${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><p>{detail.text}</p><small>{detail.sourceVideoIds.length ? `${detail.sourceVideoIds.length} kaynak video` : "Kaynak etiketi yok"}</small></div></article>)}
            {!visibleDetails.length && <div className="record-empty-panel">AI kaynağında sıralı akış veya ayrıntı notu bulunmuyor.</div>}
          </div>
        </div>
      </section>}

      {tab === "relations" && <section className="record-detail-section">
        <div className="record-section-heading"><div><small>İLİŞKİLER</small><h3>Evren bağlantıları</h3></div><span>{related.length} bağlantı</span></div>
        <div className="record-relation-list">{related.map(({ relation, other }) => <article key={relation.key}><div><small>{relation.label}</small><strong>{other?.name || (relation.fromKey === node.key ? relation.toKey : relation.fromKey)}</strong><span>{other ? workspaceLabels[other.kind] : "Evren düğümü"}</span></div><em>{relation.sourceVideoIds.length ? `${relation.sourceVideoIds.length} kaynak` : "Kaynak etiketi yok"}</em></article>)}{!related.length && <div className="record-empty-panel">Henüz onaylı bağlantı yok.</div>}</div>
        <p className="editorial-help">AI kaynaklı ilişkiler kaynak izini korumak için burada salt okunur gösterilir. İlişki kararı AI Atölyesi'ndeki evren incelemesinden gelir.</p>
      </section>}

      {tab === "sources" && <section className="record-detail-section">
        <div className="record-section-heading"><div><small>KAYNAK İZİ</small><h3>Bu bilgi hangi videolardan geldi?</h3></div><span>{node.sourceVideoIds.length} video</span></div>
        <div className="record-source-list">{node.sourceVideoIds.map((videoId, index) => <article key={videoId} title={`Video kimliği: ${videoId}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{videoSourceTitle(videoId, videoCatalog)}</strong><small>Kaynak video</small></div></article>)}{!node.sourceVideoIds.length && <div className="record-empty-panel">Kaynak video kaydı yok.</div>}</div>
        {details.length > 0 && <div className="record-source-notes"><h4>Kaynaklı ayrıntılar</h4>{details.map((detail, index) => <article key={`${detail.text}:${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><p>{detail.text}</p><small>{detail.sourceVideoIds.length ? videoSourceTitles(detail.sourceVideoIds, videoCatalog).join(" · ") : "Kaynak etiketi yok"}</small></div></article>)}</div>}
      </section>}

      {tab === "visual" && <section className="record-detail-section record-visual-section"><VisualProfileEditor item={{ key: node.key, kind: node.kind, title: node.name }} seedVisual={visual} onStatus={onStatus}/></section>}
    </div>
  </div>;
}

function LegacyTabs({ active, onChange, relationCount }: { active: LegacyTab; onChange: (tab: LegacyTab) => void; relationCount: number }) {
  return <nav className="record-detail-tabs"><button className={active === "general" ? "active" : ""} onClick={() => onChange("general")}>Genel</button><button className={active === "relations" ? "active" : ""} onClick={() => onChange("relations")}><span>İlişkiler</span><b>{relationCount}</b></button><button className={active === "visual" ? "active" : ""} onClick={() => onChange("visual")}>Görsel Profil</button></nav>;
}

export function LegacyRecordDetail({ item, relations, allItems, onReload, onStatus }: LegacyProps) {
  const bridge = window.birdesengorStudio;
  const [tab, setTab] = useState<LegacyTab>("general");
  const [title, setTitle] = useState(item.title);
  const [meta, setMeta] = useState(item.meta);
  const [summary, setSummary] = useState(item.summary);
  const [status, setStatus] = useState(item.status);
  useEffect(() => { setTab("general"); setTitle(item.title); setMeta(item.meta); setSummary(item.summary); setStatus(item.status); }, [item.key, item.title, item.meta, item.summary, item.status]);
  const linkedKeys = new Set(relations.flatMap((relation) => relation.fromKey === item.key ? [relation.toKey] : relation.toKey === item.key ? [relation.fromKey] : []));
  const linked = allItems.filter((entry) => linkedKeys.has(entry.key));
  const save = async () => { if (!bridge) return; onStatus?.(null); try { await bridge.saveItem({ ...item, title: title.trim() || item.title, meta, summary, status }); await onReload(); onStatus?.("Kayıt güncellendi.", "success"); } catch (reason) { onStatus?.(`Kayıt güncellenemedi: ${errorText(reason)}`, "error"); } };
  const remove = async () => { if (!bridge || !confirm(`“${item.title}” silinsin mi?`)) return; onStatus?.(null); try { await bridge.deleteItem(item.key); await onReload(); onStatus?.("Kayıt silindi.", "success"); } catch (reason) { onStatus?.(`Kayıt silinemedi: ${errorText(reason)}`, "error"); } };

  return <div className="record-detail-shell">
    <header className="record-detail-head"><div className="record-detail-title"><small>MANUEL {legacyLabels[item.kind].toUpperCase()}</small><h2>{item.title}</h2><div className="record-detail-facts"><span>{item.relatedCount} ilişki</span><span>{item.status === "published" ? "Yayında" : "Taslak"}</span></div></div><div className="editor-actions"><button className="danger-text" onClick={() => void remove()}>Sil</button><button className="primary-button" onClick={() => void save()}>Kaydet</button></div></header>
    <LegacyTabs active={tab} onChange={setTab} relationCount={linked.length}/>
    <div className="record-detail-body">
      {tab === "general" && <section className="record-detail-section"><div className="record-section-heading"><div><small>MANUEL KAYIT</small><h3>Temel içerik</h3></div></div><div className="editor-form record-general-form"><label><span>Başlık</span><input value={title} onChange={(event) => setTitle(event.target.value)}/></label><div className="form-two"><label><span>Bağlam / tarih</span><input value={meta} onChange={(event) => setMeta(event.target.value)}/></label><label><span>Durum</span><select value={status} onChange={(event) => setStatus(event.target.value as StudioPersistedItem["status"])}><option value="draft">Taslak</option><option value="published">Yayında</option></select></label></div><label><span>Özet</span><textarea className="record-summary-input" value={summary} onChange={(event) => setSummary(event.target.value)}/></label></div></section>}
      {tab === "relations" && <section className="record-detail-section"><div className="record-section-heading"><div><small>İLİŞKİLER</small><h3>Manuel bağlantılar</h3></div><span>{linked.length} bağlantı</span></div><div className="record-relation-list">{linked.map((entry) => <article key={entry.key}><div><small>{legacyLabels[entry.kind]}</small><strong>{entry.title}</strong><span>{entry.meta || "Yerel kayıt"}</span></div></article>)}{!linked.length && <div className="record-empty-panel">Henüz bağlantı yok.</div>}</div></section>}
      {tab === "visual" && <section className="record-detail-section record-visual-section"><VisualProfileEditor item={item} onStatus={onStatus}/></section>}
    </div>
  </div>;
}
