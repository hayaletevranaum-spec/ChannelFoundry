import { useEffect, useState } from "react";

type VisualEditorItem = { key: string; kind: string; title: string };
type SeedVisual = Partial<StudioVisualDefinition> | undefined;
type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";
type VisualOperation = "save" | "pick" | "generate" | "clear" | null;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function generationLabel(provider: string, model: string) {
  if (model) return model;
  return provider === "codex-cli" ? "Codex yerleşik görsel aracı" : "model bildirilmedi";
}

export default function VisualProfileEditor({
  item,
  seedVisual,
  size = "1024x1024",
  onStatus,
  productionActions = false,
}: {
  item: VisualEditorItem;
  seedVisual?: SeedVisual;
  size?: ImageSize;
  onStatus?: (message: string | null, tone?: "success" | "error") => void;
  productionActions?: boolean;
}) {
  const bridge = window.channelFoundryStudio;
  const [profile, setProfile] = useState<StudioVisualProfile | null>(null);
  const [capability, setCapability] = useState<StudioAiImageCapability | null>(null);
  const [description, setDescription] = useState("");
  const [attributesText, setAttributesText] = useState("");
  const [atmosphere, setAtmosphere] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<VisualOperation>(null);

  const applyProfile = (value: StudioVisualProfile | null, seed: SeedVisual = undefined) => {
    setProfile(value);
    setDescription(value?.description ?? seed?.description ?? "");
    setAttributesText((value?.attributes ?? seed?.attributes ?? []).join("\n"));
    setAtmosphere(value?.atmosphere ?? seed?.atmosphere ?? "");
    setPrompt(value?.prompt ?? seed?.prompt ?? "");
    setNegativePrompt(value?.negativePrompt ?? seed?.negativePrompt ?? "");
  };

  const load = async () => {
    if (!bridge) return;
    const nextProfile = await bridge.visualProfileGet(item.key);
    const nextCapability = productionActions ? await bridge.aiImageCapability() : null;
    applyProfile(nextProfile, seedVisual);
    setCapability(nextCapability);
  };

  useEffect(() => { void load().catch(() => undefined); }, [item.key, productionActions]);

  const input = (): StudioVisualProfileInput => ({
    entityKey: item.key,
    entityType: item.kind,
    source: profile?.source || (seedVisual ? "ai" : "manual"),
    description,
    attributes: attributesText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    atmosphere,
    prompt,
    negativePrompt,
  });

  const begin = (next: Exclude<VisualOperation, null>, message?: string) => {
    setBusy(true);
    setOperation(next);
    onStatus?.(message ?? null);
  };

  const finish = () => {
    setOperation(null);
    setBusy(false);
  };

  const save = async () => {
    if (!bridge) return;
    begin("save");
    try {
      const next = await bridge.visualProfileSave(input());
      applyProfile(next); onStatus?.("Görsel profili kaydedildi.", "success");
    } catch (reason) { onStatus?.(errorText(reason), "error"); }
    finally { finish(); }
  };

  const pick = async () => {
    if (!bridge || !productionActions) return;
    begin("pick");
    try {
      await bridge.visualProfileSave(input());
      const result = await bridge.visualImagePick({ entityKey: item.key, entityType: item.kind });
      if (!result.canceled && result.profile) { applyProfile(result.profile); onStatus?.("Görsel eklendi.", "success"); }
    } catch (reason) { onStatus?.(errorText(reason), "error"); }
    finally { finish(); }
  };

  const generate = async () => {
    if (!bridge || !productionActions || !capability?.supported || !prompt.trim()) return;
    begin("generate", "Görsel hazırlanıyor. Bu işlem birkaç dakika sürebilir.");
    try {
      const generationInput = { ...input(), size, subject: item.title };
      const result = await bridge.visualImageGenerate(generationInput);
      const controller = result.generation.controllerModel ? ` · yönetici ${result.generation.controllerModel}` : "";
      applyProfile(result.profile); onStatus?.(`Görsel üretildi · ${generationLabel(result.generation.provider, result.generation.model)}${controller}`, "success");
    } catch (reason) { onStatus?.(errorText(reason), "error"); }
    finally { finish(); }
  };

  const clear = async () => {
    if (!bridge || !productionActions || !profile?.imagePath) return;
    begin("clear");
    try {
      const result = await bridge.visualImageClear(item.key);
      applyProfile(result.profile ?? null, seedVisual); onStatus?.("Görsel kaldırıldı; metin profili korunuyor.", "success");
    } catch (reason) { onStatus?.(errorText(reason), "error"); }
    finally { finish(); }
  };

  const generating = operation === "generate";

  return <section className="entity-visual-editor">
    <div className="relations-head">
      <div><small>GÖRSEL PROFİL</small><h3>{productionActions ? "Görsel üretim ve dosya yönetimi" : "Görsel kimlik ve üretim girdisi"}</h3></div>
      <span className={productionActions && capability?.supported ? "visual-capability ready" : "visual-capability"}>
        {generating
          ? "Görsel üretimi sürüyor…"
          : productionActions
            ? capability?.supported
              ? `Doğrudan üretim · ${generationLabel(capability.provider, capability.model)}${capability.controllerModel ? ` · ${capability.controllerModel} yönetici` : ""}`
              : "Prompt + manuel görsel"
            : "Üretim 06 · Görsel Tamamlama'da"}
      </span>
    </div>
    <div className="entity-visual-layout">
      <div className="entity-visual-form">
        <label><span>Görsel açıklama</span><textarea disabled={busy} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Kaynaklarda geçen görünüş, tür, fiziksel ayrıntılar…"/></label>
        <div className="form-two"><label><span>Özellikler · satır satır</span><textarea disabled={busy} value={attributesText} onChange={(event) => setAttributesText(event.target.value)} placeholder={"Varlık türü: …\nBoy: …\nBelirgin özellik: …"}/></label><label><span>Atmosfer</span><textarea disabled={busy} value={atmosphere} onChange={(event) => setAtmosphere(event.target.value)} placeholder="Karanlık, sisli, arşiv hissi…"/></label></div>
        <label><span>Görsel üretim promptu</span><textarea disabled={busy} className="prompt-area" value={prompt} onChange={(event) => setPrompt(event.target.value)}/></label>
        <label><span>Kaçınılacak özellikler · opsiyonel</span><textarea disabled={busy} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)}/></label>
        <div className="entity-visual-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void save()}>{operation === "save" ? "Kaydediliyor…" : "Profili kaydet"}</button>
          {productionActions && <button className="secondary-button" disabled={busy} onClick={() => void pick()}>{operation === "pick" ? "Dosya seçiliyor…" : "Görsel ekle"}</button>}
          {productionActions && capability?.supported && <button className="primary-button" disabled={busy || !prompt.trim()} onClick={() => void generate()}>{generating ? "Üretiliyor…" : "Görsel üret"}</button>}
        </div>
      </div>
      <div className={`entity-visual-preview${generating ? " is-generating" : ""}`}>
        {generating
          ? <div><span>GÖRSEL ÜRETİLİYOR</span><strong>Görsel hazırlanıyor…</strong><p>Codex görsel üretimi birkaç dakika sürebilir. Studio çalışmaya devam ediyor.</p></div>
          : profile?.imageDataUrl
            ? <img src={profile.imageDataUrl} alt={`${item.title} görseli`}/>
            : <div><span>GÖRSEL DOSYASI</span><strong>Henüz eklenmedi</strong><p>{productionActions ? "Bu aşamada görsel üretebilir veya bir dosya ekleyebilirsin." : "Görsel 06 · Görsel Tamamlama aşamasında üretilecek veya eklenecek."}</p></div>}
        {profile?.imagePath && productionActions && !generating && <footer><button onClick={() => void bridge?.visualImageShow(item.key)}>Dosyayı göster</button><button className="danger-text" disabled={busy} onClick={() => void clear()}>{operation === "clear" ? "Kaldırılıyor…" : "Görseli kaldır"}</button></footer>}
      </div>
    </div>
  </section>;
}
