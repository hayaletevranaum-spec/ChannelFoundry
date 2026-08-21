import { useEffect, useMemo, useState } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";
import VisualProfileEditor from "./VisualProfileEditor";
import "./visual-completion-workbench.css";

type VisualCompletionBridge = NonNullable<typeof window.birdesengorStudio> & StudioVisualCompletionBridge;
type Selection = { type: "scene"; key: string } | { type: "entity"; key: string } | null;

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(Math.max(0, value));
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);

function sceneStatusLabel(state: StudioVisualCompletionSceneState) {
  if (state === "ready") return "Hazır";
  if (state === "skipped") return "Görselsiz";
  return "Bekliyor";
}

function entityKindLabel(kind: string) {
  if (kind === "character") return "Muhatap";
  if (kind === "location") return "Mekân";
  if (kind === "object") return "Nesne";
  if (kind === "event") return "Olay";
  if (kind === "story") return "Hikâye";
  return "Kayıt";
}

export default function VisualCompletionWorkbench() {
  const bridge = window.birdesengorStudio as VisualCompletionBridge | undefined;
  const notify = useAiWorkbenchNotice();
  const [status, setStatus] = useState<StudioVisualCompletionStatus | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    const next = await bridge.visualCompletionStatus();
    setStatus(next);
    setSelection((current) => {
      if (current?.type === "scene" && next.sections.some((entry) => entry.profileKey === current.key)) return current;
      if (current?.type === "entity" && next.entities.some((entry) => entry.profileKey === current.key)) return current;
      if (next.sections[0]) return { type: "scene", key: next.sections[0].profileKey };
      if (next.entities[0]) return { type: "entity", key: next.entities[0].profileKey };
      return null;
    });
  };

  useEffect(() => {
    void load().catch((error) => notify(errorText(error), "error"));
    return bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
  }, []);

  const scene = useMemo(() => selection?.type === "scene"
    ? status?.sections.find((entry) => entry.profileKey === selection.key) ?? null
    : null, [selection, status]);
  const entity = useMemo(() => selection?.type === "entity"
    ? status?.entities.find((entry) => entry.profileKey === selection.key) ?? null
    : null, [selection, status]);

  if (!bridge) return <div className="panel visual-completion-empty">Görsel Tamamlama Studio içinde kullanılabilir.</div>;

  const setSceneState = async (target: StudioVisualCompletionScene, state: "pending" | "skipped") => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await bridge.visualCompletionSetSceneState({ sectionKey: target.sectionKey, revisionId: target.revisionId, state });
      setStatus(next);
      notify(state === "skipped" ? "Bölüm görselsiz bırakıldı; bu karar publication v2 tarafından korunacak." : "Bölüm yeniden görsel bekleyen duruma alındı.", "success");
    } catch (error) { notify(errorText(error), "error"); }
    finally { setBusy(false); }
  };

  const editorStatus = (message: string | null, tone?: "success" | "error") => {
    if (!message) return;
    notify(message, tone === "error" ? "error" : "success");
    void load().catch(() => undefined);
  };

  return <div className="visual-completion-workbench">
    <header className="panel visual-completion-header">
      <div>
        <small>06 · GÖRSEL TAMAMLAMA</small>
        <h2>Onaylı anlatının görsel katmanını tamamla</h2>
        <p>Sahne görselleri anlatı revizyonundan ayrı tutulur. Karakter, mekân ve nesne görselleri ortak arşiv profillerini kullanır; fiziksel sayfa yerleşimini tema belirler.</p>
      </div>
      <span className={`visual-completion-state${status?.complete ? " complete" : ""}`}>{status?.complete ? "SAHNE KARARLARI TAMAM" : "GÖRSEL KARARI BEKLİYOR"}</span>
    </header>

    <section className="visual-completion-metrics">
      <div className="panel"><small>SAHNE HAZIR</small><strong>{number(status?.counts.sceneReady ?? 0)}</strong><span>Görsel dosyası</span></div>
      <div className="panel"><small>GÖRSELSİZ</small><strong>{number(status?.counts.sceneSkipped ?? 0)}</strong><span>Açık editoryal karar</span></div>
      <div className="panel"><small>BEKLİYOR</small><strong>{number(status?.counts.scenePending ?? 0)}</strong><span>Bölüm sahnesi</span></div>
      <div className="panel"><small>ARŞİV GÖRSELİ</small><strong>{number(status?.counts.entityReady ?? 0)} / {number(status?.counts.entities ?? 0)}</strong><span>Referans entity</span></div>
    </section>

    {!status?.sections.length ? <section className="panel visual-completion-gate empty">
      <div><small>ONAYLI ANLATI BEKLENİYOR</small><strong>Önce 05 · Hikâyeleştir aşamasında en az bir bölüm onaylanmalı.</strong><p>Görsel Tamamlama yalnız yaşayan anlatı belleğinin güncel onaylı revizyonları için slot oluşturur.</p></div>
    </section> : <>
      <section className={`panel visual-completion-gate${status.complete ? " complete" : " pending"}`}>
        <div><small>SAHNE KARARI</small><strong>{status.complete ? "Bütün aktif bölümler için görsel kararı var." : `${number(status.counts.scenePending)} bölüm sahne kararı bekliyor.`}</strong><p>Bir bölüm için görsel üretebilir, manuel dosya ekleyebilir veya bilinçli olarak görselsiz bırakabilirsin. Anlatı revize edilirse yeni revizyon yeni bir sahne slotu alır.</p></div>
        <span>Publication v2’ye semantik asset olarak aktarılacak</span>
      </section>

      <div className="visual-completion-layout">
        <aside className="panel visual-completion-index">
          <div className="visual-completion-index-head"><small>ANLATI SAHNELERİ</small><strong>{number(status.sections.length)} bölüm</strong></div>
          <div className="visual-completion-list">{status.sections.map((entry) => <button key={entry.profileKey} className={`${selection?.type === "scene" && selection.key === entry.profileKey ? "active " : ""}${entry.state}`} onClick={() => setSelection({ type: "scene", key: entry.profileKey })}>
            <span className="visual-completion-order">{String(entry.position).padStart(2, "0")}</span><div><strong>{entry.title}</strong><small>revizyon {entry.revisionNo} · {number(entry.sourceVideoIds.length)} kaynak video</small></div><i>{sceneStatusLabel(entry.state)}</i>
          </button>)}</div>

          <div className="visual-completion-index-head entity-head"><small>ARŞİV REFERANSLARI</small><strong>{number(status.entities.length)}</strong></div>
          {status.entities.length ? <div className="visual-completion-list entities">{status.entities.map((entry) => <button key={entry.profileKey} className={`${selection?.type === "entity" && selection.key === entry.profileKey ? "active " : ""}${entry.hasImage ? "ready" : "pending"}`} onClick={() => setSelection({ type: "entity", key: entry.profileKey })}>
            <span className="visual-completion-kind">{entityKindLabel(entry.kind).slice(0, 2).toUpperCase()}</span><div><strong>{entry.label}</strong><small>{entityKindLabel(entry.kind)} · {number(entry.sectionKeys.length)} bölüm</small></div><i>{entry.hasImage ? "Hazır" : "Opsiyonel"}</i>
          </button>)}</div> : <p className="visual-completion-none">Anlatıda inline entity referansı yok.</p>}
        </aside>

        <main className="visual-completion-detail">
          {scene ? <>
            <section className="panel visual-completion-context">
              <header><div><small>SAHNE · REVİZYON {scene.revisionNo}</small><h3>{scene.title}</h3></div><span className={`scene-state ${scene.state}`}>{sceneStatusLabel(scene.state)}</span></header>
              <p>{scene.body}</p>
              <div className="visual-completion-provenance"><div><small>ASSET ID</small><code>{scene.assetId}</code></div><div><small>KAYNAK VİDEOLAR</small><span>{scene.sourceVideoIds.length ? scene.sourceVideoIds.join(" · ") : "—"}</span></div><div><small>EVREN REFERANSLARI</small><span>{scene.entityReferences.length ? scene.entityReferences.map((entry) => entry.label).join(" · ") : "—"}</span></div></div>
              <div className="visual-completion-decision">{scene.state === "skipped" ? <button className="secondary-button" disabled={busy} onClick={() => void setSceneState(scene, "pending")}>Tekrar görsel kullan</button> : scene.state === "pending" ? <button className="secondary-button" disabled={busy} onClick={() => void setSceneState(scene, "skipped")}>Bu bölümü görselsiz bırak</button> : <span>Görsel hazır. Görselsiz bırakmak istersen önce aşağıdaki editörden görseli kaldır.</span>}</div>
            </section>
            {scene.state === "skipped" ? <section className="panel visual-completion-skipped"><small>EDİTORYAL KARAR</small><strong>Bu revizyon görselsiz yayınlanacak.</strong><p>Karar yalnız bu anlatı revizyonuna aittir. Bölüm daha sonra revize edilirse yeni revizyon yeniden görsel kararı bekler.</p></section> : <VisualProfileEditor productionActions item={{ key: scene.profileKey, kind: "narrative-scene", title: scene.title }} seedVisual={scene.seed} size="1536x1024" onStatus={editorStatus}/>} 
          </> : entity ? <>
            <section className="panel visual-completion-context entity-context">
              <header><div><small>{entityKindLabel(entity.kind).toUpperCase()} · ARŞİV PROFİLİ</small><h3>{entity.label}</h3></div><span className={`scene-state ${entity.hasImage ? "ready" : "pending"}`}>{entity.hasImage ? "Görsel hazır" : "Opsiyonel görsel"}</span></header>
              <div className="visual-completion-provenance"><div><small>ENTITY ID</small><code>{entity.entityId}</code></div><div><small>ASSET ID</small><code>{entity.assetId}</code></div><div><small>KULLANILDIĞI BÖLÜMLER</small><span>{entity.sectionKeys.join(" · ")}</span></div></div>
            </section>
            <VisualProfileEditor productionActions item={{ key: entity.profileKey, kind: entity.kind, title: entity.label }} seedVisual={entity.seed} size="1024x1024" onStatus={editorStatus}/>
          </> : <section className="panel visual-completion-empty">Bir sahne veya arşiv referansı seç.</section>}
        </main>
      </div>
    </>}
  </div>;
}
