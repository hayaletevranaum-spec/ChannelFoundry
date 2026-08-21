import { useEffect, useMemo, useState } from "react";
import { useVideoSourceCatalog, videoSourceTitles } from "./video-source-labels";

type LegacyItem = StudioPersistedItem & { relatedCount: number };
type OpenRecord = (source: "workspace" | "legacy", key: string) => void;
type Detail = { text: string; sourceVideoIds: string[] };

type Props = {
  nodes: StudioUniverseWorkspaceNode[];
  legacyItems: LegacyItem[];
  onOpenRecord: OpenRecord;
};

function textArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

function detailArray(value: unknown): Detail[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const text = String(record.text ?? "").trim();
    if (!text) return null;
    return { text, sourceVideoIds: textArray(record.sourceVideoIds) };
  }).filter((entry): entry is Detail => Boolean(entry));
}

function payload(node: StudioUniverseWorkspaceNode) {
  return node.payload && typeof node.payload === "object" ? node.payload as Record<string, unknown> : {};
}

function includesStory(node: StudioUniverseWorkspaceNode, storyName: string) {
  return textArray(payload(node).storyNames).some((name) => name.toLocaleLowerCase("tr-TR") === storyName.toLocaleLowerCase("tr-TR"));
}

export default function EditorialTimelineView({ nodes, legacyItems, onOpenRecord }: Props) {
  const videoCatalog = useVideoSourceCatalog();
  const stories = useMemo(() => nodes.filter((node) => node.kind === "story" && node.state === "approved"), [nodes]);
  const [storyKey, setStoryKey] = useState<string>(stories[0]?.key ?? "");

  useEffect(() => {
    if (stories.some((story) => story.key === storyKey)) return;
    setStoryKey(stories[0]?.key ?? "");
  }, [stories, storyKey]);

  const selected = stories.find((story) => story.key === storyKey) ?? null;
  const sequence = selected ? detailArray(payload(selected).sequence) : [];
  const connected = selected ? nodes.filter((node) => node.key !== selected.key && node.state === "approved" && includesStory(node, selected.name)) : [];
  const events = connected.filter((node) => node.kind === "event");
  const locations = connected.filter((node) => node.kind === "location");
  const people = connected.filter((node) => node.kind === "character");
  const objects = connected.filter((node) => node.kind === "object");
  const sourceCount = new Set(sequence.flatMap((step) => step.sourceVideoIds)).size || selected?.sourceVideoIds.length || 0;
  const legacyEvents = legacyItems.filter((item) => item.kind === "event").sort((a, b) => a.meta.localeCompare(b.meta, "tr"));

  return <section className="editorial-timeline-workspace">
    <div className="timeline-header-card">
      <div><small>ANLATI ZAMANI</small><h2>Hikâyeyi kaynaklı adımlarla oku.</h2><p>Bu görünüm takvim tarihi uydurmaz. AI tarafından çıkarılan sıralı anlatıyı, bağlı olayları ve kaynak izlerini editoryal kontrol için yan yana gösterir.</p></div>
      <label><span>Hikâye hattı</span><select value={storyKey} onChange={(event) => setStoryKey(event.target.value)}>{stories.map((story) => <option key={story.key} value={story.key}>{story.name}</option>)}</select></label>
    </div>

    {selected ? <>
      <div className="timeline-metrics">
        <article><span>AKIŞ ADIMI</span><strong>{sequence.length}</strong><small>sıralı anlatı parçası</small></article>
        <article><span>BAĞLI OLAY</span><strong>{events.length}</strong><small>bu hikâyeyi taşıyan olay</small></article>
        <article><span>KAYNAK VİDEO</span><strong>{sourceCount}</strong><small>akışta kullanılan iz</small></article>
        <article><span>BAĞLAM</span><strong>{locations.length + people.length + objects.length}</strong><small>kişi, mekân ve nesne</small></article>
      </div>

      <div className="timeline-layout">
        <section className="timeline-story-panel">
          <header><div><small>HİKÂYE / AKIŞ</small><h2>{selected.name}</h2><p>{selected.summary}</p></div><button onClick={() => onOpenRecord("workspace", selected.key)}>Hikâye kaydını aç →</button></header>
          <ol className="timeline-sequence">
            {sequence.map((step, index) => <li key={`${selected.key}:${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><p>{step.text}</p><small>{step.sourceVideoIds.length ? `${step.sourceVideoIds.length} kaynak video · ${videoSourceTitles(step.sourceVideoIds, videoCatalog).join(" · ")}` : "Kaynak etiketi yok"}</small></div></li>)}
            {!sequence.length && <li className="timeline-empty"><div><p>Bu hikâye için sıralı anlatı akışı üretilmemiş.</p><small>Hikâye kaydındaki özet ve ilişkiler yine kullanılabilir.</small></div></li>}
          </ol>
        </section>

        <aside className="timeline-context-panel">
          <header><small>BAĞLI DOSYALAR</small><strong>{connected.length} kayıt</strong></header>
          {[...events, ...people, ...locations, ...objects].map((node) => <button key={node.key} onClick={() => onOpenRecord("workspace", node.key)}><span>{node.kind === "character" ? "Muhatap" : node.kind === "event" ? "Olay" : node.kind === "location" ? "Mekân" : "Nesne"}</span><strong>{node.name}</strong><small>{node.sourceVideoIds.length} kaynak video</small></button>)}
          {!connected.length && <div className="timeline-context-empty">Bu hikâye adına bağlı ek editoryal düğüm yok.</div>}
        </aside>
      </div>
    </> : <div className="timeline-no-story">Henüz onaylı hikâye hattı yok. Timeline, onaylı bir hikâyenin sıralı akışını temel alır.</div>}

    {legacyEvents.length > 0 && <section className="legacy-timeline-section"><header><div><small>MANUEL / TARİHLİ OLAYLAR</small><h3>Yerel olay kayıtları</h3></div><span>{legacyEvents.length} olay</span></header><div>{legacyEvents.map((item) => <button key={item.key} onClick={() => onOpenRecord("legacy", item.key)}><span>{item.meta || "Tarih yok"}</span><strong>{item.title}</strong><p>{item.summary}</p></button>)}</div></section>}
  </section>;
}
