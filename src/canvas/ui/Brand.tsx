export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="bb-brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="mark-frame"
        d="M7.5 12V7.5H12M20 7.5h4.5V12M24.5 20v4.5H20M12 24.5H7.5V20"
      />
      <path className="mark-link" d="m10.5 11.5 5 4.5 6-5M15.5 16v5" />
      <circle className="mark-node" cx="10.5" cy="11.5" r="2.35" />
      <circle className="mark-node" cx="21.5" cy="11" r="2.35" />
      <circle className="mark-node" cx="15.5" cy="21" r="2.35" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`bb-brand ${compact ? "compact" : ""}`}>
      <BrandMark size={compact ? 20 : 24} />
      <span>Branchboard</span>
    </div>
  );
}
