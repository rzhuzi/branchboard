import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

export type ToastTone = "info" | "success" | "error";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  tone?: ToastTone;
  action?: ToastAction;
  duration?: number;
};

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};

type ToastContextValue = {
  pushToast: (message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      if (!message) return;
      const id = crypto.randomUUID();
      const item: ToastItem = {
        id,
        message,
        tone: options.tone ?? "info",
        action: options.action
      };
      setToasts((current) => [...current.slice(-2), item]);
      const duration = options.duration ?? (options.action ? 6500 : 3600);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration)
      );
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="bb-toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`bb-toast ${toast.tone}`}>
            <span className="bb-toast-mark" aria-hidden="true">
              {toast.tone === "error" ? "!" : toast.tone === "success" ? "✓" : "·"}
            </span>
            <span className="bb-toast-message">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                className="bb-toast-action"
                onClick={() => {
                  const action = toast.action;
                  dismiss(toast.id);
                  action?.onClick();
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="bb-toast-close"
              aria-label="关闭提示"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
