import { useState } from "react";
import {
  readStudioAppearance,
  saveStudioAppearance,
  type StudioAppearance,
  type StudioTextSize,
  type StudioTheme,
} from "./studio-appearance";

const textOptions: Array<{ value: StudioTextSize; label: string; detail: string }> = [
  { value: "standard", label: "Standart", detail: "Daha yoğun çalışma alanı" },
  { value: "comfortable", label: "Rahat", detail: "Uzun okuma ve düzeltme için önerilen" },
  { value: "large", label: "Büyük", detail: "Daha büyük metin ve kontroller" },
];

const themeOptions: Array<{ value: StudioTheme; label: string; detail: string }> = [
  { value: "dark", label: "Koyu", detail: "Mevcut Studio görünümü" },
  { value: "light", label: "Açık", detail: "Gündüz ve uzun metin okumaları için" },
];

export default function AppearanceSettings() {
  const [appearance, setAppearance] = useState<StudioAppearance>(() => readStudioAppearance());

  const update = (patch: Partial<StudioAppearance>) => {
    const next = saveStudioAppearance({ ...appearance, ...patch });
    setAppearance(next);
  };

  return <section className="panel appearance-settings">
    <header className="appearance-settings-head">
      <div>
        <small>OKUMA KONFORU</small>
        <h2>Studio görünümü</h2>
        <p>Uzun editoryal oturumlarda metinleri daha rahat okumak için görünümü cihazına göre ayarla. Değişiklikler anında uygulanır ve bu bilgisayarda hatırlanır.</p>
      </div>
      <div className="appearance-reading-sample" aria-hidden="true">
        <span>ÖRNEK</span>
        <strong>Okunabilir metin</strong>
        <p>Satır aralığı ve metin genişliği uzun okumada göz yorgunluğunu azaltacak şekilde dengelenir.</p>
      </div>
    </header>

    <div className="appearance-settings-grid">
      <fieldset>
        <legend>Metin boyutu</legend>
        <div className="appearance-choice-grid three">
          {textOptions.map((option) => <button
            key={option.value}
            type="button"
            className={appearance.textSize === option.value ? "appearance-choice active" : "appearance-choice"}
            aria-pressed={appearance.textSize === option.value}
            onClick={() => update({ textSize: option.value })}
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>)}
        </div>
      </fieldset>

      <fieldset>
        <legend>Renk teması</legend>
        <div className="appearance-choice-grid two">
          {themeOptions.map((option) => <button
            key={option.value}
            type="button"
            className={appearance.theme === option.value ? "appearance-choice active" : "appearance-choice"}
            aria-pressed={appearance.theme === option.value}
            onClick={() => update({ theme: option.value })}
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>)}
        </div>
      </fieldset>
    </div>

    <footer className="appearance-settings-note">
      <strong>Okuma yardımı etkin</strong>
      <span>Uzun anlatı ve inceleme metinlerinde daha geniş satır aralığı, yaklaşık 80 karakterlik okuma satırı ve belirgin klavye odağı otomatik uygulanır.</span>
    </footer>
  </section>;
}
