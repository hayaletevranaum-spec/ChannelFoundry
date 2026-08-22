import { useEffect, useMemo, useState } from "react";

type ItemKind = "video" | "character" | "event" | "file";
type ItemStatus = "published" | "draft";
type BulkAction = "publish" | "draft" | "delete";

type Item = {
  key: string;
  id: string;
  kind: ItemKind;
  title: string;
  meta: string;
  summary: string;
  status: ItemStatus;
};

type Relation = {
  id: string;
  fromKey: string;
  toKey: string;
};

const labels: Record<ItemKind, string> = {
  video: "Kayıt",
  character: "Karakter",
  event: "Olay",
  file: "Dosya",
};

const short: Record<ItemKind, string> = {
  video: "KY",
  character: "KR",
  event: "OL",
  file: "DS",
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function BulkOperations({ onStatus }: { onStatus?: (message: string | null, tone?: "success" | "error") => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ItemKind | "all">("all");
  const [status, setStatus] = useState<ItemStatus | "all">("all");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const bridge = window.channelFoundryStudio;
    if (!bridge) throw new Error("Toplu işlemler yalnızca Electron Studio içinde kullanılabilir.");
    const state = await bridge.loadState();
    setItems(state.items);
    setRelations(state.relations);
  };

  useEffect(() => {
    void load().catch((loadError) => onStatus?.(errorText(loadError), "error"));
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("tr-TR");
    return items.filter((item) =>
      (kind === "all" || item.kind === kind)
      && (status === "all" || item.status === status)
      && (!term || `${item.title} ${item.meta} ${item.summary}`.toLocaleLowerCase("tr-TR").includes(term)),
    );
  }, [items, kind, status, query]);

  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.key)), [items, selected]);
  const selectedRelations = useMemo(() => relations.filter((relation) => selected.has(relation.fromKey) || selected.has(relation.toKey)).length, [relations, selected]);

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectVisible = () => setSelected((current) => new Set([...current, ...filtered.map((item) => item.key)]));
  const clearSelection = () => setSelected(new Set());

  const apply = async (action: BulkAction) => {
    if (!selected.size || busy) return;
    const actionLabel = action === "publish" ? "Yayına al" : action === "draft" ? "Taslağa çek" : "Sil";
    const extra = action === "delete" && selectedRelations
      ? ` Seçimle ilişkili ${selectedRelations} bağlantı da etkilenebilir.`
      : "";
    if (!window.confirm(`${selected.size} içerik için “${actionLabel}” işlemi uygulansın mı?${extra}`)) return;

    setBusy(true);
    onStatus?.(null);
    try {
      const result = await window.channelFoundryStudio!.bulkApply({ action, keys: [...selected] });
      await load();
      clearSelection();
      const relationText = action === "delete" && result.affectedRelations
        ? ` ${result.affectedRelations} bağlantı da kaldırıldı.`
        : "";
      onStatus?.(`${result.affected} içerik güncellendi.${relationText} Ana Studio penceresi de yenilendi.`, "success");
    } catch (applyError) {
      onStatus?.(errorText(applyError), "error");
    } finally {
      setBusy(false);
    }
  };

  return <div className="bulk-shell">
    <header className="bulk-header">
      <div>
        <small>OTOMASYON / TOPLU İŞLEMLER</small>
        <h1>Birden fazla kaydı tek kararla yönet.</h1>
        <p>Seçimlerini filtrele; yayın durumunu topluca değiştir veya kontrollü biçimde sil. İşlemler yerel SQLite üzerinde tek transaction olarak uygulanır.</p>
      </div>
      <div className="bulk-count"><strong>{selected.size}</strong><span>seçili</span></div>
    </header>

    <section className="bulk-toolbar panel">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="İçeriklerde ara…"/>
      <select value={kind} onChange={(event) => setKind(event.target.value as ItemKind | "all")}>
        <option value="all">Tüm türler</option>
        <option value="video">Kayıtlar</option>
        <option value="character">Karakterler</option>
        <option value="event">Olaylar</option>
        <option value="file">Dosyalar</option>
      </select>
      <select value={status} onChange={(event) => setStatus(event.target.value as ItemStatus | "all")}>
        <option value="all">Tüm durumlar</option>
        <option value="published">Yayında</option>
        <option value="draft">Taslak</option>
      </select>
      <button className="secondary-button" onClick={selectVisible}>Görünenleri seç</button>
      <button className="text-button" onClick={clearSelection}>Seçimi temizle</button>
    </section>

    <div className="bulk-grid">
      <section className="panel bulk-list-panel">
        <div className="bulk-panel-head"><div><small>ARŞİV</small><h2>{filtered.length} içerik</h2></div><span>{items.length} toplam</span></div>
        <div className="bulk-list">
          {filtered.map((item) => <label key={item.key} className={selected.has(item.key) ? "selected" : ""}>
            <input type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)}/>
            <span className="kind-badge">{short[item.kind]}</span>
            <span className="bulk-item-copy"><strong>{item.title}</strong><small>{labels[item.kind]} · {item.meta || "Bağlam yok"}</small></span>
            <span className={item.status === "published" ? "status-pill published" : "status-pill"}>{item.status === "published" ? "Yayında" : "Taslak"}</span>
          </label>)}
          {!filtered.length && <p className="bulk-empty">Bu filtrede içerik yok.</p>}
        </div>
      </section>

      <aside className="panel bulk-actions">
        <small>SEÇİM ÖZETİ</small>
        <h2>{selected.size ? `${selected.size} içerik hazır` : "İçerik seç"}</h2>
        <div className="bulk-stat"><span>Yayında</span><strong>{selectedItems.filter((item) => item.status === "published").length}</strong></div>
        <div className="bulk-stat"><span>Taslak</span><strong>{selectedItems.filter((item) => item.status === "draft").length}</strong></div>
        <div className="bulk-stat"><span>İlişkili bağlantı</span><strong>{selectedRelations}</strong></div>
        <div className="bulk-action-buttons">
          <button className="primary-button" disabled={!selected.size || busy} onClick={() => void apply("publish")}>Yayına al</button>
          <button className="secondary-button" disabled={!selected.size || busy} onClick={() => void apply("draft")}>Taslağa çek</button>
          <button className="danger-button" disabled={!selected.size || busy} onClick={() => void apply("delete")}>Seçilenleri sil</button>
        </div>
        <div className="bulk-note"><strong>Canlı site ayrı bir adımdır.</strong><p>Buradaki değişiklik SQLite’a kaydedilir. Webi güncellemek için ana Studio’daki Yayınla ekranından “Canlıya yayınla” kullanılır.</p></div>
      </aside>
    </div>
  </div>;
}
