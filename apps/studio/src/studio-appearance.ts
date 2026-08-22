export type StudioTheme = "dark" | "light";
export type StudioTextSize = "standard" | "comfortable" | "large";

export type StudioAppearance = {
  theme: StudioTheme;
  textSize: StudioTextSize;
};

const STORAGE_KEY = "channel-foundry:studio-appearance-v1";
const DEFAULT_APPEARANCE: StudioAppearance = { theme: "dark", textSize: "comfortable" };

function theme(value: unknown): StudioTheme {
  return value === "light" ? "light" : "dark";
}

function textSize(value: unknown): StudioTextSize {
  if (value === "standard" || value === "large") return value;
  return "comfortable";
}

export function readStudioAppearance(): StudioAppearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<StudioAppearance> | null;
    return {
      theme: theme(parsed?.theme),
      textSize: textSize(parsed?.textSize),
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function applyStudioAppearance(value: StudioAppearance) {
  const root = document.documentElement;
  root.dataset.studioTheme = theme(value.theme);
  root.dataset.studioTextSize = textSize(value.textSize);
  root.style.colorScheme = value.theme === "light" ? "light" : "dark";
}

export function saveStudioAppearance(value: StudioAppearance) {
  const normalized: StudioAppearance = {
    theme: theme(value.theme),
    textSize: textSize(value.textSize),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  applyStudioAppearance(normalized);
  window.dispatchEvent(new CustomEvent("channel-foundry:studio-appearance", { detail: normalized }));
  return normalized;
}
