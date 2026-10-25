import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({
  size = 16,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 4.5v11M4.5 10h11" />
    </IconBase>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7.5 5.5H4v-3.5" />
      <path d="M4.2 5.6a6.2 6.2 0 1 1-1.2 5" />
    </IconBase>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.5 5.5H16v-3.5" />
      <path d="M15.8 5.6a6.2 6.2 0 1 0 1.2 5" />
    </IconBase>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="7" y="7" width="9" height="9" rx="1.6" />
      <path d="M13 7V5.6A1.6 1.6 0 0 0 11.4 4H5.6A1.6 1.6 0 0 0 4 5.6v5.8A1.6 1.6 0 0 0 5.6 13H7" />
    </IconBase>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="14" cy="15" r="2" />
      <path d="M6 7v2.5A2.5 2.5 0 0 0 8.5 12H12a2 2 0 0 0 2-2V8" />
    </IconBase>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.4 8.8v4.4M11.6 8.8v4.4" />
    </IconBase>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 3.5v9M6.6 9.4 10 12.8l3.4-3.4M4 15.5h12" />
    </IconBase>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.8v1.3M10 15.9v1.3M2.8 10h1.3M15.9 10h1.3M4.9 4.9l.9.9M14.2 14.2l.9.9M15.1 4.9l-.9.9M5.8 14.2l-.9.9" />
    </IconBase>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15.8 12.2A6.3 6.3 0 0 1 7.8 4.2a6.3 6.3 0 1 0 8 8Z" />
    </IconBase>
  );
}

export function HelpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M7.8 7.7a2.3 2.3 0 1 1 3.2 2.1c-.7.4-1 .8-1 1.6v.3" />
      <circle cx="10" cy="14.2" r=".65" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.8" />
      <circle cx="7.3" cy="8" r="1.2" />
      <path d="m4.5 13.5 3.6-3.3 2.6 2.4 2-1.8 2.8 2.7" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4.5 10.5 3.3 3.3 7.7-7.6" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
    </IconBase>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <IconBase {...props} strokeWidth="0">
      <circle cx="7" cy="6" r="1.05" fill="currentColor" />
      <circle cx="13" cy="6" r="1.05" fill="currentColor" />
      <circle cx="7" cy="10" r="1.05" fill="currentColor" />
      <circle cx="13" cy="10" r="1.05" fill="currentColor" />
      <circle cx="7" cy="14" r="1.05" fill="currentColor" />
      <circle cx="13" cy="14" r="1.05" fill="currentColor" />
    </IconBase>
  );
}

export function LocateIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="10" r="4.6" />
      <path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2" />
    </IconBase>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5.5 7.5 4.5 4.5 4.5-4.5" />
    </IconBase>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m12.6 4.2 3.2 3.2-8.3 8.3-4.1 1 1-4.1Z" />
      <path d="m10.8 6 3.2 3.2" />
    </IconBase>
  );
}

export function SquareIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4.5" y="4.5" width="11" height="11" rx="1" />
    </IconBase>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 16 16 4M8 4h8v8" />
    </IconBase>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 10h11" />
    </IconBase>
  );
}

export function FitIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 4H4v3M13 16h3v-3M16 7V4h-3M4 13v3h3" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
    </IconBase>
  );
}
