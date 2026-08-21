import { useEffect, useMemo, useState } from "react";
import "./universe-maintenance-settings.css";

type CountMap = Record<string, number | null>;
type MaintenanceStatus = {
  confirmation: string;
  reset: CountMap;
  preserved: CountMap;
  resetCount: number;
  active: boolean;
  activeRunId: number | null;
  blockedReason: string;
};
type MaintenanceResetResult = {
  ok: true;
  backup: string;
  removed: CountMap;
  after: MaintenanceStatus;
};
type MaintenanceBridge = NonNullable<Window["birdesengorStudio"]> & {
  universeMaintenanceStatus(): Promise<MaintenanceStatus>;
  universeMaintenanceReset(input: { confirmation: string }): Promise<MaintenanceResetResult>;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function UniverseMaintenanceSettings() {
  const bridge = window.birdesengorStudio as MaintenanceBridge | undefined;
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!bridge) return;
    setStatus(await bridge.universeMaintenanceStatus());
  };

  useEffect(() => { void load().catch((reason) => setError(errorText(reason))); }, []);

  const canReset = useMemo(() => Boolean(
    status
    && !status.active
    && status.resetCount > 0
    && confirmation.trim() === status.confirmation,
  ), [status, confirmation]);

  const runReset = async () => {
    if (!bridge || !status || !canReset) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await bridge.universeMaintenanceReset({ confirmation });
      setStatus(result.after);
      setMessage(`Evren çalışma alanı sıfırlandı. Yedek: ${result.backup}`);
      setConfirmation("");
      setOpen(false);
    } catch (reason) {
      setError(errorText(reason));
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel settings-card universe-maintenance-card">
    <small>BAKIM</small>
    <h2>Evreni Baştan Oluştur</h2>
    <p className="universe-maintenance-copy">
      Çözümlemeleri, Ayıklama kararlarını, sponsor/katkı kayıtlarını, katalog ve altyazıları korur;
      yalnız türetilmiş Evren çalışma alanını temizler.
    </p>

    <dl className="universe-maintenance-counts">
      <div><dt>Evren kayıtları</dt><dd>{status?.reset.universe_workspace_nodes ?? "—"}</dd></div>
      <div><dt>Evren bağlantıları</dt><dd>{status?.reset.universe_workspace_relations ?? "—"}</dd></div>
      <div><dt>İşlenmiş kaynak kilidi</dt><dd>{status?.reset.universe_ingest_sources ?? "—"}</dd></div>
      <div><dt>Korunan çözümleme</dt><dd>{status?.preserved.source_ai_analyses ?? "—"}</dd></div>
      <div><dt>Korunan Ayıklama</dt><dd>{status?.preserved.ai_analysis_editorial_reviews ?? "—"}</dd></div>
    </dl>

    <div className="universe-maintenance-note">
      <strong>Canlı Web yayını değişmez.</strong>
      <span>İşlemden önce otomatik SQLite yedeği oluşturulur. Sıfırlama sonrası işlenmiş kaynaklar yeniden Ayıklama ve Evrene İşleme akışına açılır.</span>
    </div>

    {status?.active && <div className="universe-maintenance-warning">{status.blockedReason}</div>}
    {message && <div className="universe-maintenance-success">{message}</div>}
    {error && <div className="universe-maintenance-warning">{error}</div>}

    {!open ? <button
      className="universe-maintenance-open"
      disabled={!status || status.active || status.resetCount === 0 || busy}
      onClick={() => { setOpen(true); setError(null); setMessage(null); }}
    >
      {status?.resetCount === 0 ? "Sıfırlanacak Evren verisi yok" : "Evreni Baştan Oluştur"}
    </button> : <div className="universe-maintenance-confirm">
      <p>Bu işlem mevcut editoryal Evren kayıtlarını ve işlenmiş kaynak kilitlerini kaldırır. Devam etmek için aşağıdaki metni yaz:</p>
      <code>{status?.confirmation}</code>
      <input
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        placeholder={status?.confirmation || "Onay metni"}
        autoComplete="off"
        disabled={busy}
      />
      <div>
        <button className="universe-maintenance-cancel" onClick={() => { setOpen(false); setConfirmation(""); }} disabled={busy}>Vazgeç</button>
        <button className="universe-maintenance-reset" onClick={() => void runReset()} disabled={!canReset || busy}>
          {busy ? "Yedekleniyor ve sıfırlanıyor…" : "Yedeği oluştur ve Evreni sıfırla"}
        </button>
      </div>
    </div>}
  </section>;
}
