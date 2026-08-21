import { useEffect, useMemo, useState } from "react";

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
type OpenRecord = (source: "workspace" | "legacy", key: string) => void;
type KindFilter = "all" | StudioUniverseWorkspaceNode["kind"] | StudioPersistedItem["kind"];

type RefNode = {
  source: "workspace" | "legacy";
  key: string;
  title: string;
  kind: string;
  kindLabel: string;
  summary: string;
};

type RelationRow = {
  id: string;
  from: RefNode;
  to: RefNode;
  label: string;
  sourceVideoIds: string[];
  origin: "AI evreni" | "Manuel";
};

type Props = {
  nodes: StudioUniverseWorkspaceNode[];
  workspaceRelations: WorkspaceRelation[];
  legacyItems: LegacyItem[];
  legacyRelations: StudioPersistedRelation[];
  onOpenRecord: OpenRecord;
};

const kindLabels: Record<string, string> = {
  story: "Hikâye",
  character: "Muhatap",
  event: "Olay",
  location: "Mekân",
  object: "Nesne",
  video: "Kayıt",
  file: "Dosya",
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

export default function EditorialRelationsView({ nodes, workspaceRelations, legacyItems, legacyRelations, onOpenRecord }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const model = useMemo(() => {
    const refs = new Map<string, RefNode>();
    for (const node of nodes) {
      refs.set(node.key, {
        source: "workspace",
        key: node.key,
        title: node.name,
        kind: node.kind,
        kindLabel: kindLabels[node.kind] ?? node.kind,
        summary: node.summary,
      });
    }
    for (const item of legacyItems) {
      if (!refs.has(item.key)) {
        refs.set(item.key, {
          source: "legacy",
          key: item.key,
          title: item.title,
          kind: item.kind,
          kindLabel: kindLabels[item.kind] ?? item.kind,
          summary: item.summary,
        });
      }
    }

    const rows: RelationRow[] = [];
    for (const relation of workspaceRelations) {
      const from = refs.get(relation.fromKey);
      const to = refs.get(relation.toKey);
      if (!from || !to) continue;
      rows.push({ id: `workspace:${relation.key}`, from, to, label: relation.label, sourceVideoIds: relation.sourceVideoIds, origin: "AI evreni" });
    }
    for (const relation of legacyRelations) {
      const from = refs.get(relation.fromKey);
      const to = refs.get(relation.toKey);
      if (!from || !to) continue;
      rows.push({ id: `legacy:${relation.id}`, from, to, label: relation.label, sourceVideoIds: [], origin: "Manuel" });
    }

    const degree = new Map<string, number>();
    rows.forEach((row) => {
      degree.set(row.from.key, (degree.get(row.from.key) ?? 0) + 1);
      degree.set(row.to.key, (degree.get(row.to.key) ?? 0) + 1);
    });
    const connected = Array.from(refs.values())
      .filter((ref) => (degree.get(ref.key) ?? 0) > 0)
      .sort((a, b) => (degree.get(b.key) ?? 0) - (degree.get(a.key) ?? 0) || a.title.localeCompare(b.title, "tr"));
    return { rows, degree, connected };
  }, [nodes, workspaceRelations, legacyItems, legacyRelations]);

  const term = normalize(query);
  const visibleNodes = useMemo(() => model.connected.filter((node) => {
    if (kind !== "all" && node.kind !== kind) return false;
    return !term || normalize(`${node.title} ${node.kindLabel} ${node.summary}`).includes(term);
  }), [model.connected, kind, term]);

  useEffect(() => {
    if (focusKey && visibleNodes.some((node) => node.key === focusKey)) return;
    setFocusKey(visibleNodes[0]?.key ?? null);
  }, [visibleNodes, focusKey]);

  const focused = focusKey ? model.connected.find((node) => node.key === focusKey) ?? null : null;
  const focusedRows = focused ? model.rows.filter((row) => row.from.key === focused.key || row.to.key === focused.key) : [];
  const uniqueSources = new Set(model.rows.flatMap((row) => row.sourceVideoIds)).size;

  return <section className="editorial-relations-workspace">
    <div className="editorial-context-metrics">
      <article><span>ONAYLI BAĞ</span><strong>{model.rows.length}</strong><small>public ilişki adayı</small></article>
      <article><span>BAĞLI DÜĞÜM</span><strong>{model.connected.length}</strong><small>en az bir ilişki taşıyor</small></article>
      <article><span>KAYNAK İZİ</span><strong>{uniqueSources}</strong><small>ilişkileri destekleyen video</small></article>
    </div>

    <div className="editorial-context-toolbar">
      <label><span>Bağlantılarda ara</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kişi, hikâye, mekân…"/></label>
      <label><span>Tür</span><select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)}><option value="all">Tüm türler</option><option value="story">Hikâye</option><option value="character">Muhatap</option><option value="event">Olay</option><option value="location">Mekân</option><option value="object">Nesne</option><option value="video">Kayıt</option><option value="file">Dosya</option></select></label>
    </div>

    <div className="editorial-context-layout">
      <aside className="editorial-context-index">
        <header><div><small>ODAK DÜĞÜMLERİ</small><strong>{visibleNodes.length} kayıt</strong></div><span>Bağ yoğunluğuna göre</span></header>
        <div className="editorial-context-node-list">
          {visibleNodes.map((node) => <button key={node.key} className={focusKey === node.key ? "active" : ""} onClick={() => setFocusKey(node.key)}>
            <span className="context-kind-badge">{node.kindLabel.slice(0, 2).toUpperCase()}</span>
            <span><small>{node.kindLabel}</small><strong>{node.title}</strong></span>
            <em>{model.degree.get(node.key) ?? 0}</em>
          </button>)}
          {!visibleNodes.length && <div className="context-empty">Bu filtrede bağlı kayıt yok.</div>}
        </div>
      </aside>

      <section className="editorial-context-focus">
        {focused ? <>
          <header className="editorial-context-focus-head">
            <div><small>{focused.kindLabel.toUpperCase()} / ODAK</small><h2>{focused.title}</h2><p>{focused.summary || "Bu kayıt için kısa özet yok."}</p></div>
            <div><strong>{focusedRows.length}<small>bağlantı</small></strong><button onClick={() => onOpenRecord(focused.source, focused.key)}>Kaydı aç →</button></div>
          </header>
          <div className="editorial-relation-rays">
            {focusedRows.map((row) => {
              const outgoing = row.from.key === focused.key;
              const other = outgoing ? row.to : row.from;
              return <article key={row.id}>
                <button className="relation-target" onClick={() => setFocusKey(other.key)}><small>{other.kindLabel}</small><strong>{other.title}</strong><span>Bu düğüme odaklan →</span></button>
                <div className="relation-copy"><span>{outgoing ? "→" : "←"}</span><div><strong>{row.label || "bağlantılı"}</strong><small>{row.origin}{row.sourceVideoIds.length ? ` · ${row.sourceVideoIds.length} kaynak video` : ""}</small></div></div>
                <button className="relation-record-open" onClick={() => onOpenRecord(other.source, other.key)}>Dosya →</button>
              </article>;
            })}
            {!focusedRows.length && <div className="context-empty">Bu kayıt için görünür ilişki yok.</div>}
          </div>
        </> : <div className="context-empty large">İncelemek için soldan bir düğüm seç.</div>}
      </section>
    </div>
  </section>;
}
