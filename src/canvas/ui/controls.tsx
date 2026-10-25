import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  danger?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
};

export function IconButton({
  label,
  active = false,
  danger = false,
  size = "md",
  className = "",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`bb-icon-button ${size} ${active ? "active" : ""} ${
        danger ? "danger" : ""
      } ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  children: ReactNode;
};

export function Button({
  variant = "secondary",
  className = "",
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`bb-button ${variant} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="bb-spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="bb-kbd">{children}</kbd>;
}
