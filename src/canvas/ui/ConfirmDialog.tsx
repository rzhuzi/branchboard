import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "删除",
  cancelLabel = "取消",
  danger = true,
  onConfirm,
  onCancel
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="bb-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="bb-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        <div className="bb-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="bb-button secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`bb-button ${danger ? "danger-solid" : "primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
