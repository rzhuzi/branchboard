import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { MSG, type ThemeMessage } from "../../shared/messages";
import {
  getSettings,
  listenSettings,
  saveSettings,
  systemTheme
} from "../../shared/settings";
import type { Theme } from "../../shared/types";

type SettingsContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({
  children,
  embedded
}: {
  children: ReactNode;
  embedded: boolean;
}) {
  const [theme, setTheme] = useState<Theme>(() => systemTheme());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSettings().then((settings) => {
      if (cancelled) return;
      setTheme(settings.theme);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = listenSettings((settings) => {
      setTheme(settings.theme);
      setHydrated(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (embedded) {
      window.parent.postMessage({ type: MSG.theme, theme } satisfies ThemeMessage, "*");
    }
  }, [embedded, theme]);

  useEffect(() => {
    if (!hydrated) return;
    void saveSettings({ theme });
  }, [hydrated, theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ theme, toggleTheme }),
    [theme, toggleTheme]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used inside SettingsProvider");
  return context;
}
