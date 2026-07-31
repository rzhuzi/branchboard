import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  getExecutionSettings,
  setExecutionSettings
} from "../shared/browser";
import type {
  ExecutionSettings,
  WorkspaceMode
} from "../shared/types";

type ExecutionSettingsContextValue = ExecutionSettings & {
  setMode: (mode: WorkspaceMode) => void;
};

const ExecutionSettingsContext =
  createContext<ExecutionSettingsContextValue | null>(null);

export function ExecutionSettingsProvider({
  children
}: {
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<ExecutionSettings>({
    mode: "manual"
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getExecutionSettings().then((stored) => {
      if (cancelled) return;
      setSettings(stored);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void setExecutionSettings(settings);
  }, [hydrated, settings]);

  const value = useMemo<ExecutionSettingsContextValue>(
    () => ({
      ...settings,
      setMode: (mode) => setSettings((current) => ({ ...current, mode }))
    }),
    [settings]
  );

  return (
    <ExecutionSettingsContext.Provider value={value}>
      {children}
    </ExecutionSettingsContext.Provider>
  );
}

export function useExecutionSettings(): ExecutionSettingsContextValue {
  const context = useContext(ExecutionSettingsContext);
  if (!context) {
    throw new Error("useExecutionSettings must be used inside its provider");
  }
  return context;
}

