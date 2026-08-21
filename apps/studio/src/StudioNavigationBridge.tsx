import { useEffect } from "react";

export default function StudioNavigationBridge() {
  useEffect(() => {
    const bridge = window.birdesengorStudio;
    if (!bridge?.onNavigate) return;
    return bridge.onNavigate((section) => {
      if (section === "Muhataplar") {
        sessionStorage.setItem("birdesengor:editor-mode", "characters");
        const target = Array.from(document.querySelectorAll<HTMLButtonElement>(".pipeline-sidebar .studio-nav button"))
          .find((button) => button.textContent?.trim() === "Kayıt Dosyaları");
        target?.click();
        window.dispatchEvent(new CustomEvent("birdesengor:editor-mode", { detail: "characters" }));
        return;
      }
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".pipeline-sidebar .studio-nav button"));
      const target = buttons.find((button) => button.textContent?.trim() === section);
      target?.click();
    });
  }, []);
  return null;
}
