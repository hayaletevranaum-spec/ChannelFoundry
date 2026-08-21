import { useEffect, useState, type FormEvent } from "react";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function CommunityAdminSettings() {
  const bridge = window.birdesengorStudio;
  const [session, setSession] = useState<StudioCommunitySession | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!bridge) return;
    const next = await bridge.communitySession();
    setSession(next);
    setUsername((current) => current || next.username || "");
  };

  useEffect(() => {
    void refresh().catch((reason) => setError(errorText(reason)));
    return bridge?.onDataChanged?.(() => { void refresh().catch(() => undefined); });
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!password) {
        if (!session?.configured) throw new Error("Yönetici parolası gerekli.");
        const next = await bridge.communityAdminConnect();
        setSession(next);
        if (!next.connected) throw new Error(next.lastError || "Kayıtlı yönetici bağlantısı kurulamadı.");
        setNotice("Kayıtlı bilgilerle forum yönetici bağlantısı doğrulandı.");
        return;
      }
      const result = await bridge.communityAdminSave({ username, password });
      setSession(result.session);
      setUsername(result.session.username || username);
      setPassword("");
      setShowPassword(false);
      setNotice("Yönetici bilgileri güvenli olarak kaydedildi. Bundan sonra bağlantı uygulama açılışında otomatik kurulacak.");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!bridge || !window.confirm("Kayıtlı forum yönetici bağlantısı silinsin mi?")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bridge.communityAdminClear();
      setSession(result.session);
      setUsername("");
      setPassword("");
      setShowPassword(false);
      setNotice("Kayıtlı yönetici bağlantısı silindi.");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!bridge) return null;

  return <section className="panel community-connection-settings">
    <header>
      <div><small>FORUM YÖNETİMİ</small><h2>Yönetici bağlantısı</h2></div>
      <span className={session?.connected ? "community-connection-state connected" : session?.configured ? "community-connection-state warning" : "community-connection-state"}>
        <span className="local-dot"/>{session?.connected ? "Bağlı" : session?.configured ? "Bağlantı bekliyor" : "Yapılandırılmadı"}
      </span>
    </header>
    <p>Bu bağlantı üye girişi değildir. Studio, web forumunun yönetim işlemleri için kayıtlı yönetici hesabını arka planda kullanır.</p>
    <div className="community-connection-facts">
      <div><span>Sunucu</span><strong title={session?.endpoint}>{session?.endpoint || "—"}</strong></div>
      <div><span>Otomatik bağlantı</span><strong>{session?.configured ? "Etkin" : "Kapalı"}</strong></div>
      <div><span>Yönetici</span><strong>{session?.username || "—"}</strong></div>
      <div><span>Parola saklama</span><strong>{session?.secureStorageAvailable ? "Sistem korumalı" : "Kullanılamıyor"}</strong></div>
    </div>
    <form onSubmit={(event) => void save(event)}>
      <label><span>Yönetici kullanıcı adı</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" required/></label>
      <label><span>Yönetici parolası</span><div className="community-password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={session?.configured ? "Kayıtlı parola korunur" : "Yönetici parolası"}/><button type="button" className="secondary-button" disabled={!password} onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Gizle" : "Göster"}</button></div></label>
      {(error || notice || session?.lastError) && <div className={error || session?.lastError && !session.connected ? "community-admin-notice error" : "community-admin-notice"}>{error || notice || session?.lastError}</div>}
      {!session?.secureStorageAvailable && <div className="community-admin-notice error">Güvenli parola saklama servisi kullanılamadığı için kalıcı yönetici bağlantısı kaydedilemez.</div>}
      <div className="community-connection-actions">
        {session?.configured && <button type="button" className="text-button" disabled={busy} onClick={() => void clear()}>Kayıtlı bilgileri sil</button>}
        <button className="primary-button" type="submit" disabled={busy || !username || !session?.secureStorageAvailable}>{busy ? "Doğrulanıyor…" : password ? "Kaydet ve bağlantıyı dene" : "Bağlantıyı yenile"}</button>
      </div>
    </form>
  </section>;
}
