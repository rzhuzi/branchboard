import type { Theme } from "./types";

export const SETTINGS_KEY = "branchboardV2Settings";

export type Settings = {
  theme: Theme;
};

export function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function defaultSettings(): Settings {
  return { theme: systemTheme() };
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function normalizeSettings(value: unknown): Settings {
  const theme =
    typeof value === "object" &&
    value !== null &&
    "theme" in value &&
    (value as { theme?: unknown }).theme === "light"
      ? "light"
      : typeof value === "object" &&
          value !== null &&
          "theme" in value &&
          (value as { theme?: unknown }).theme === "dark"
        ? "dark"
        : systemTheme();
  return { theme };
}

export async function getSettings(): Promise<Settings> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    const stored = result[SETTINGS_KEY];
    return stored === undefined ? defaultSettings() : normalizeSettings(stored);
  }
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? normalizeSettings(JSON.parse(stored)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return;
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Theme is not critical enough to interrupt canvas work.
  }
}

export function listenSettings(callback: (settings: Settings) => void): () => void {
  if (hasChromeStorage()) {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
      callback(normalizeSettings(changes[SETTINGS_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
  const listener = (event: StorageEvent) => {
    if (event.key !== SETTINGS_KEY || !event.newValue) return;
    try {
      callback(normalizeSettings(JSON.parse(event.newValue)));
    } catch {
      // Ignore malformed local settings.
    }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export async function readShellTheme(): Promise<Theme> {
  try {
    if (hasChromeStorage()) {
      const result = await chrome.storage.local.get(SETTINGS_KEY);
      return normalizeSettings(result[SETTINGS_KEY]).theme;
    }
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? normalizeSettings(JSON.parse(stored)).theme : systemTheme();
  } catch {
    return systemTheme();
  }
}
