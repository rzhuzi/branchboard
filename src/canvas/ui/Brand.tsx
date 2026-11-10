export function BrandMark({ size = 25 }: { size?: number }) {
  return (
    <svg
      className="bb-brand-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 5v14h5a5 5 0 0 0 0-10H5m5 0h3a4 4 0 0 0 0-8H9" />
      <circle cx="18" cy="18" r="2" fill="var(--bb-accent)" stroke="none" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`bb-brand ${compact ? "compact" : ""}`}>
      <BrandMark size={compact ? 21 : 25} />
      <span>Branchboard</span>
    </div>
  );
}
