import { useEffect, useState } from "react";
import { useAiWorkbenchNotice } from "./AiWorkbenchStatus";

type Props = {
  entityKey: string;
  entityType: string;
  title: string;
  visual: StudioVisualDefinition;
  capability?: StudioAiImageCapability | null;
  compact?: boolean;
  source?: string;
  productionActions?: boolean;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function generationLabel(provider: string, model: string) {
  if (model) return model;
  return provider === "codex-cli" ? "Codex yerleşik görsel aracı" : "model bildirilmedi";
}

export default function VisualPromptCard({ entityKey, entityType, title, visual, capability, compact = false, source = "ai", productionActions = false }: Props) {
  const bridge = window.channelFoundryStudio;
  const notify = useAiWorkbenchNotice();
  const [profile, setProfile] = useState<StudioVisualProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!bridge) return;
    setProfile(await bridge.visualProfileGet(entityKey));
  };

  useEffect(() => { void load().catch(() => undefined); }, [entityKey]);

  const persistPrompt = async () => {
    if (!bridge) return null;
    const saved = await bridge.visualProfileSave({
      entityKey,
      entityType,
      source,
      description: visual.description,
      attributes: visual.attributes,
      atmosphere: visual.atmosphere,
      prompt: visual.prompt,
      negativePrompt: visual.negativePrompt,
    });
    setProfile(saved);
    return saved;
  };

  const copyPrompt = async () => {
    if (!productionActions) return;
    try {
      const text = [visual.prompt, visual.negativePrompt ? `\nKaçınılacak özellikler: ${visual.negativePrompt}` : ""].filter(Boolean).join("\n");
      await navigator.clipboard.writeText(text);
      notify("Görsel üretim metni panoya kopyalandı.", "success");
    } catch (reason) { notify(errorText(reason), "error"); }
  };

  const pickImage = async () => {
    if (!bridge || !productionActions) return;
    setBusy(true);
    try {
      await persistPrompt();
      const result = await bridge.visualImagePick({ entityKey, entityType });
      if (!result.canceled && result.profile) { setProfile(result.profile); notify("Görsel yerel arşive eklendi.", "success"); }
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const generateImage = async () => {
    if (!bridge || !productionActions || !capability?.supported || !visual.prompt) return;
    setBusy(true);
    try {
      const result = await bridge.visualImageGenerate({
        entityKey,
        entityType,
        source,
        description: visual.description,
        attributes: visual.attributes,
        atmosphere: visual.atmosphere,
        prompt: visual.prompt,
        negativePrompt: visual.negativePrompt,
        size: "1024x1024",
      });
      setProfile(result.profile);
      const controller = result.generation.controllerModel ? ` · yönetici ${result.generation.controllerModel}` : "";
      notify(`Görsel üretildi · ${generationLabel(result.generation.provider, result.generation.model)}${controller}`, "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const clearImage = async () => {
    if (!bridge || !productionActions || !profile?.imagePath) return;
    setBusy(true);
    try {
      const result = await bridge.visualImageClear(entityKey);
      setProfile(result.profile ?? null);
      notify("Görsel kaldırıldı; prompt korunuyor.", "success");
    } catch (reason) { notify(errorText(reason), "error"); }
    finally { setBusy(false); }
  };

  const hasPrompt = Boolean(visual.prompt.trim());
  return <article className={`visual-prompt-card ${compact ? "compact" : ""}`}>
    <div className="visual-prompt-copy">
      <small>GÖRSEL TANIM</small>
      <strong>{title}</strong>
      {visual.description && <p>{visual.description}</p>}
      {visual.attributes.length > 0 && <div className="visual-attributes">{visual.attributes.map((attribute) => <span key={attribute}>{attribute}</span>)}</div>}
      {visual.atmosphere && <p className="visual-atmosphere">Atmosfer · {visual.atmosphere}</p>}
      {hasPrompt ? <textarea readOnly value={visual.prompt}/> : <p className="visual-empty">Bu öğe için yeterli görsel ayrıntı çıkarılmadı.</p>}
      {visual.negativePrompt && <p className="visual-negative">Kaçınılacak: {visual.negativePrompt}</p>}
      {productionActions ? <div className="visual-actions">
        <button className="secondary-button" disabled={!hasPrompt || busy} onClick={() => void copyPrompt()}>Promptu kopyala</button>
        <button className="secondary-button" disabled={busy} onClick={() => void pickImage()}>Görsel ekle</button>
        {capability?.supported && <button className="primary-button" disabled={!hasPrompt || busy} onClick={() => void generateImage()}>{busy ? "İşleniyor…" : "Görsel üret"}</button>}
      </div> : <p className="visual-empty">Görsel üretimi ve dosya yönetimi 06 · Görsel Tamamlama aşamasında yapılır.</p>}
    </div>
    <div className="visual-preview">
      {profile?.imageDataUrl ? <img src={profile.imageDataUrl} alt={`${title} görseli`}/> : <div><span>GÖRSEL</span><p>06 · Görsel Tamamlama aşamasında hazırlanacak</p></div>}
      {profile?.imagePath && productionActions && <footer><button onClick={() => void bridge?.visualImageShow(entityKey)}>Dosyayı göster</button><button className="danger-text" disabled={busy} onClick={() => void clearImage()}>Kaldır</button></footer>}
    </div>
  </article>;
}
