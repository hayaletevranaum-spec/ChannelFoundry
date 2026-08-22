import { useEffect, useMemo, useState } from "react";
import AiEditorialReview from "./AiEditorialReview";
import RevisionReviewPane from "./RevisionReviewPane";
import "./revision-review.css";
import "./review-readiness.css";

type ReviewMode = "records" | "revisions";
type WorkspaceCountsWithRevisions = StudioUniverseWorkspaceStatus["counts"] & { pendingRevisions?: number };
type UniverseRevision = { id:number; nodeKey:string; state:"pending"|"applied"|"dismissed"; proposed?:{ name?:string } };
type EditorialReviewBridge = {
  universeWorkspaceStatus(): Promise<StudioUniverseWorkspaceStatus>;
  universeWorkspaceList(input: { view: "revisions" }): Promise<UniverseRevision[]>;
  universeWorkspaceList(): Promise<StudioUniverseWorkspaceNode[]>;
  onDataChanged?(callback: () => void): () => void;
};

function number(value: number) { return new Intl.NumberFormat("tr-TR").format(Math.max(0, value)); }

export default function EditorialReviewWorkspace({ initialMode = "records", onReadyForUniverse }: { initialMode?: ReviewMode; onReadyForUniverse?: () => void }) {
  const bridge = window.channelFoundryStudio as unknown as EditorialReviewBridge | undefined;
  const [mode, setMode] = useState<ReviewMode>(initialMode);
  const [counts, setCounts] = useState<WorkspaceCountsWithRevisions | null>(null);
  const [revisionNames, setRevisionNames] = useState<string[]>([]);

  const load = async () => {
    if (!bridge) return;
    const [status, revisionRows, nodeRows] = await Promise.all([
      bridge.universeWorkspaceStatus(),
      bridge.universeWorkspaceList({ view: "revisions" }),
      bridge.universeWorkspaceList(),
    ]);
    setCounts(status.counts as WorkspaceCountsWithRevisions);
    const names = revisionRows
      .filter((entry) => entry.state === "pending")
      .map((entry) => nodeRows.find((node) => node.key === entry.nodeKey)?.name || entry.proposed?.name || "Adsız kayıt")
      .filter(Boolean);
    setRevisionNames([...new Set(names)]);
  };

  useEffect(() => { setMode(initialMode); }, [initialMode]);
  useEffect(() => {
    void load().catch(() => undefined);
    return bridge?.onDataChanged?.(() => { void load().catch(() => undefined); });
  }, []);

  const draftCount = counts?.draft ?? 0;
  const revisionCount = counts?.pendingRevisions ?? 0;
  const visibleRevisionNames = useMemo(() => revisionNames.slice(0, 8), [revisionNames]);

  const finishReview = () => {
    if (revisionCount > 0) { setMode("revisions"); return; }
    onReadyForUniverse?.();
  };

  return <div className="editorial-review-workspace">
    <header className="review-mode-header panel">
      <div>
        <small>04 · İNCELEME</small>
        <strong>Editoryal karar alanı</strong>
        <span>Yeni kayıtları onayla; onaylı kayıtlara gelen değişiklikleri ayrı revizyon olarak değerlendir.</span>
      </div>
      <nav aria-label="İnceleme türü">
        <button className={mode === "records" ? "active" : ""} onClick={() => setMode("records")}>
          <span>Yeni Kayıtlar</span><b>{number(draftCount)}</b>
        </button>
        <button className={mode === "revisions" ? "active" : ""} onClick={() => setMode("revisions")}>
          <span>Revizyonlar</span><b>{number(revisionCount)}</b>
        </button>
      </nav>
    </header>

    <section className={`panel review-readiness-gate${revisionCount ? " needs-review" : " ready"}`}>
      <div>
        <small>SONRAKİ TUR KONTROLÜ</small>
        {revisionCount ? <>
          <strong>{number(revisionCount)} kayıt yeni bilgi aldı.</strong>
          <p>Yeni Evrene İşleme turundan önce yalnız aşağıdaki kayıtların revizyon kararını tamamla.</p>
          <div className="review-readiness-names">
            {visibleRevisionNames.map((name) => <span key={name}>{name}</span>)}
            {revisionNames.length > visibleRevisionNames.length && <span>+{number(revisionNames.length - visibleRevisionNames.length)} kayıt</span>}
          </div>
        </> : <>
          <strong>İnceleme sonraki tura hazır.</strong>
          <p>{draftCount ? `${number(draftCount)} taslak kayıt gizli durumda bekleyebilir; yeni kaynakları engellemez.` : "Bekleyen revizyon yok."}</p>
        </>}
      </div>
      <button className={revisionCount ? "primary-button" : "secondary-button"} onClick={finishReview}>
        {revisionCount ? `Revizyonları tamamla · ${number(revisionCount)}` : "Evrene İşlemeye dön"}
      </button>
    </section>

    {mode === "records" ? <AiEditorialReview/> : <RevisionReviewPane/>}
  </div>;
}
