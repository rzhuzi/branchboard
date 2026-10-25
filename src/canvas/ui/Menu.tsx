import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type MenuEntry = MenuItem | "separator";

type MenuProps = {
  x: number;
  y: number;
  header?: string;
  items: MenuEntry[];
  onClose: () => void;
};

export function Menu({ x, y, header, items, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    });
    const first = menu.querySelector<HTMLButtonElement>("button:not(:disabled)");
    first?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const close = (event?: Event) => {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    const handleWindowEvent = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const menu = menuRef.current;
      if (!menu) return;
      const buttons = Array.from(
        menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
      );
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "ArrowDown"
          ? buttons[(index + 1) % buttons.length]
          : buttons[(index - 1 + buttons.length) % buttons.length];
      next.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", handleWindowEvent);
    window.addEventListener("resize", handleWindowEvent);
    window.addEventListener("wheel", handleWindowEvent, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", handleWindowEvent);
      window.removeEventListener("resize", handleWindowEvent);
      window.removeEventListener("wheel", handleWindowEvent);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="bb-menu"
      style={{ left: position.left, top: position.top }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {header ? <div className="bb-menu-header">{header}</div> : null}
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={`separator-${index}`} className="bb-menu-separator" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            className={`bb-menu-item ${item.danger ? "danger" : ""}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
          >
            <span className="bb-menu-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="bb-menu-label">{item.label}</span>
            {item.shortcut ? <span className="bb-menu-shortcut">{item.shortcut}</span> : null}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
