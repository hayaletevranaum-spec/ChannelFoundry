import { useEffect, useState } from "react";
import {
  formatExportDate,
  publishErrorText,
  type LivePublicationInfo,
  type PublicationInfo,
  type PublicationPreview,
  type PublishItem,
  type PublishRelation,
  type ThemePublicationExport,
} from "./publish-model";

type LocalExportResult = ThemePublicationExport & {
  root: string;
  itemCount?: number;
  publicationV2?: ThemePublicationExport;
};

type LiveExportResult = LocalExportResult & {
  uploadedAssets: number;
  live: LivePublicationInfo;
};

type PublicationBridge = Omit<
  NonNullable<typeof window.birdesengorStudio>,
  "exportPublicSnapshot" | "publishPublicSnapshot" | "getPublicationInfo"
> & {
  publicationPreview(): Promise<PublicationPreview>;
  exportPublicSnapshot(): Promise<LocalExportResult>;
  publishPublicSnapshot(): Promise<LiveExportResult>;
  getPublicationInfo(): Promise<PublicationInfo | null>;
};

function exportInfo(result: LocalExportResult): PublicationInfo {
  const value = result.publicationV2 ?? result;
  return {
    generatedAt: String(value.generatedAt ?? ""),
    file: String(value.file ?? ""),
    publicationId: String(value.publicationId ?? ""),
    contentFingerprint: String(value.contentFingerprint ?? ""),
    sectionCount: Number(value.sectionCount ?? 0),
    entityCount: Number(value.entityCount ?? 0),
    relationCount: Number(value.relationCount ?? 0),
    assetCount: Number(value.assetCount ?? 0),
  };
}

export default function PublishCenter({ items, relations, workspaceNodes, workspaceStatus }: {
  items: PublishItem[];
  relations: PublishRelation[];
  workspaceNodes: StudioUniverseWorkspaceNode[];
  workspaceStatus: StudioUniverseWorkspaceStatus | null;
}) {
  void items;
  void relations;
  void workspaceNodes;
  void workspaceStatus;

  const [publicationInfo, setPublicationInfo] = useState<PublicationInfo | null>(null);
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [livePublication, setLivePublication] = useState<LivePublicationInfo | null>(null);
  const [communityConnected, setCommunityConnected] = useState(false);
  const [localBuilding, setLocalBuilding] = useState(false);
  const [livePublishing, setLivePublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (bridge: PublicationBridge) => {
    const [info, session, nextPreview] = await Promise.all([
      bridge.getPublicationInfo(),
      bridge.communitySession(),
      bridge.publicationPreview(),
    ]);
    setPublicationInfo(info);
    setCommunityConnected(Boolean(session?.connected));
    setPreview(nextPreview ?? null);
  };

  useEffect(() => {
    let cancelled = false;
    const bridge = window.birdesengorStudio as PublicationBridge | undefined;
    const reload = async () => {
      if (!bridge) return;
      try {
        await load(bridge);
      } catch (loadError) {
        if (!cancelled) setError(publishErrorText(loadError));
      }
    };
    void reload();
    const unsubscribe = bridge?.onDataChanged?.(() => { void reload(); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  const readiness = preview?.readiness;
  const ready = Boolean(readiness?.readyForTheme);
  const counts = preview?.counts ?? { sections: 0, entities: 0, relations: 0, assets: 0 };
  const reasons = [
    ...(readiness && readiness.narrativeSections === 0 ? ["05 · Hikâyeleştir aşamasında en az bir anlatı bölümü onaylanmalı."] : []),
    ...(readiness?.narrativeChangesPending ? ["Onaylı Evren değişiklikleri yaşayan anlatıya henüz uygulanmadı; 05 · Hikâyeleştir tamamlanmalı."] : []),
    ...(readiness && readiness.narrativeSections > 0 && !readiness.visualComplete ? ["06 · Görsel Tamamlama içinde bölüm sahneleri için karar bekliyor."] : []),
  ];

  const buildLocal = async () => {
    const bridge = window.birdesengorStudio as PublicationBridge | undefined;
    if (!bridge) {
      setError("Yerel publication paketi yalnızca Electron Studio içinde oluşturulabilir.");
      return;
    }
    setLocalBuilding(true);
    setError(null);
    try {
      const result = await bridge.exportPublicSnapshot();
      setPublicationInfo(exportInfo(result));
      setPreview(await bridge.publicationPreview());
    } catch (buildError) {
      setError(publishErrorText(buildError));
    } finally {
      setLocalBuilding(false);
    }
  };

  const publishLive = async () => {
    const bridge = window.birdesengorStudio as PublicationBridge | undefined;
    if (!bridge) {
      setError("Canlı yayın yalnızca Electron Studio içinde yapılabilir.");
      return;
    }
    const latestPreview = await bridge.publicationPreview();
    setPreview(latestPreview);
    if (!latestPreview.readiness.readyForTheme) {
      setError("Publication v2 henüz canlı yayına hazır değil. Önce 05 · Hikâyeleştir ve 06 · Görsel Tamamlama kapılarını tamamla.");
      return;
    }
    const session = await bridge.communitySession();
    setCommunityConnected(Boolean(session.connected));
    if (!session.connected) {
      setError("Canlı yayın için önce Topluluk ekranından Studio yönetici bağlantısını kur.");
      return;
    }
    const confirmed = window.confirm(
      `${latestPreview.counts.sections} anlatı bölümü, ${latestPreview.counts.entities} arşiv kaydı ve ${latestPreview.counts.assets} görsel yeni Kitap Web'e yayınlansın mı?`,
    );
    if (!confirmed) return;

    setLivePublishing(true);
    setError(null);
    try {
      const result = await bridge.publishPublicSnapshot();
      setPublicationInfo(exportInfo(result));
      setLivePublication(result.live);
      setPreview(await bridge.publicationPreview());
    } catch (publishError) {
      setError(publishErrorText(publishError));
    } finally {
      setLivePublishing(false);
    }
  };

  const revealPackage = async () => {
    try {
      await window.birdesengorStudio?.showPublicExport();
    } catch (revealError) {
      setError(publishErrorText(revealError));
    }
  };

  const lastLiveAt = livePublication?.generatedAt ?? preview?.baseline?.generatedAt ?? null;
  const publishStatus = error
    || (localBuilding ? "Publication v2 yerel paketi oluşturuluyor…" : "")
    || (livePublishing ? "Asset'ler yükleniyor, publication.json etkinleştiriliyor ve doğrulanıyor…" : "")
    || (livePublication
      ? `Canlı yayın doğrulandı · ${formatExportDate(livePublication.generatedAt)}`
      : lastLiveAt ? `Son canlı yayın · ${formatExportDate(lastLiveAt)}` : "Henüz canlı publication v2 yayını yapılmadı.");

  return <section className="publish-center">
    <section className={`panel theme-publication-panel${ready ? " ready" : " waiting"}`}>
      <div className="theme-publication-head">
        <div>
          <small>KİTAP WEB · PUBLICATION V2</small>
          <h3>Studio’dan yeni Web temasına tek yayın hattı</h3>
          <p>Onaylı yaşayan anlatı, arşiv ilişkileri ve semantik görseller `content/publication.json` + `content/assets/` paketi olarak hazırlanır. Yayınlama artık yalnız bu sözleşmeyi kullanır.</p>
        </div>
        <span>{ready ? "CANLI YAYINA HAZIR" : "HAZIRLIK BEKLİYOR"}</span>
      </div>

      <div className="theme-publication-metrics">
        <div><small>ANLATI</small><strong>{counts.sections}</strong><span>Onaylı bölüm</span></div>
        <div><small>ARŞİV</small><strong>{counts.entities}</strong><span>Approved entity</span></div>
        <div><small>BAĞLANTI</small><strong>{counts.relations}</strong><span>Approved relation</span></div>
        <div><small>ASSET</small><strong>{counts.assets}</strong><span>Publication görseli</span></div>
      </div>

      {reasons.length ? <div className="theme-publication-gates">
        <strong>Publication v2 henüz canlı yayına hazır değil.</strong>
        {reasons.map((reason) => <p key={reason}>{reason}</p>)}
      </div> : <div className="theme-publication-gates ready">
        <strong>05 ve 06 kapıları tamam.</strong>
        <p>Canlı yayın önce içerik-hash'li asset'leri yükler, ardından publication.json dosyasını atomik olarak etkinleştirir.</p>
      </div>}

      <div className="publish-actions">
        <span className={error ? "publish-inline-status error" : "publish-inline-status"} aria-live="polite">{publishStatus}</span>
        <button className="secondary-button" disabled={livePublishing || localBuilding} onClick={() => void buildLocal()}>
          {localBuilding ? "Oluşturuluyor…" : "Yerel paketi oluştur"}
        </button>
        <button className="primary-button" disabled={!ready || !communityConnected || livePublishing || localBuilding} onClick={() => void publishLive()}>
          {livePublishing ? "Yayınlanıyor…" : "Kitap Web'i canlıya yayınla"}
        </button>
      </div>

      <div className={communityConnected ? "live-readiness ready" : "live-readiness"}>
        <span className="local-dot"/>
        {communityConnected ? "Studio yönetici bağlantısı hazır · publication v2 canlı yayını kullanılabilir" : "Canlı yayın için Topluluk ekranından yönetici bağlantısı gerekir"}
      </div>
    </section>

    <section className="panel last-export-panel">
      <div className="publish-panel-head">
        <div><small>SON YEREL PUBLICATION</small><h3>{publicationInfo ? formatExportDate(publicationInfo.generatedAt) : "Henüz paket oluşturulmadı"}</h3></div>
        {publicationInfo && <button className="secondary-button" onClick={() => void revealPackage()}>Klasörde göster</button>}
      </div>
      {publicationInfo ? <>
        <div className="last-export-stats">
          <span><small>Anlatı</small><strong>{publicationInfo.sectionCount}</strong></span>
          <span><small>Arşiv</small><strong>{publicationInfo.entityCount}</strong></span>
          <span><small>Bağlantı</small><strong>{publicationInfo.relationCount}</strong></span>
          <span><small>Asset</small><strong>{publicationInfo.assetCount}</strong></span>
        </div>
        <p className="export-path">{publicationInfo.file}</p>
        {publicationInfo.publicationId && <code>{publicationInfo.publicationId} · {publicationInfo.contentFingerprint.slice(0, 20)}…</code>}
      </> : <p>İlk paket oluşturulduğunda publication ID, fingerprint ve dosya yolu burada tutulacak.</p>}

      {livePublication && <div className="live-proof">
        <div><span className="local-dot"/><strong>Canlı publication v2 doğrulandı</strong><small>{formatExportDate(livePublication.generatedAt)}</small></div>
        <div><span>{livePublication.sectionCount} bölüm</span><span>{livePublication.entityCount} entity</span><span>{livePublication.assetCount} asset</span><span>{Math.max(1, Math.round(livePublication.bytes / 1024))} KB</span></div>
        <p>{livePublication.publicUrl}</p>
        <code>{livePublication.contentFingerprint.slice(0, 20)}…</code>
      </div>}

      {preview?.baseline && <div className="automation-note">
        <span>CANLI BASELINE</span>
        <p>{preview.changed ? "Yerel approved içerik canlı publication'dan farklı." : "Yerel approved içerik canlı publication ile aynı fingerprint'e sahip."}</p>
      </div>}
    </section>
  </section>;
}
