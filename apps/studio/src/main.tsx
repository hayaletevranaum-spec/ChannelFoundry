import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { studioLogoUrl } from "./studio-assets";
import { applyStudioAppearance, readStudioAppearance } from "./studio-appearance";
import "./studio-theme-tokens.css";
import "./styles.css";
import "./pipeline.css";
import "./dashboard.css";
import "./editorial-workspace.css";
import "./record-detail.css";
import "./editorial-context-workspace.css";
import "./video-archive.css";
import "./video-archive-settings.css";
import "./bulk-operations.css";
import "./ai-workbench.css";
import "./ai-production-workbench.css";
import "./ai-stage-rail-compact.css";
import "./ai-editorial-review.css";
import "./visual-profile.css";
import "./records-editor-fix.css";
import "./support-records-editor.css";
import "./ytdlp-settings.css";
import "./web-connection-settings.css";
import "./studio-layout.css";
import "./studio-workspace-layout.css";
import "./studio-accessibility.css";
import "./studio-theme-bindings.css";

applyStudioAppearance(readStudioAppearance());

const favicon = document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/png";
favicon.href = studioLogoUrl;
document.head.append(favicon);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
