export function CiderMark({ size = 22 }: { size?: number }) {
  const width = Math.round((size * 210) / 190);
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 210 190"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="60" y="0" width="120" height="50" rx="25" fill="currentColor" />
      <rect x="0" y="70" width="110" height="50" rx="25" fill="currentColor" />
      <rect x="130" y="70" width="80" height="50" rx="25" fill="#ff8200" />
      <rect x="60" y="140" width="120" height="50" rx="25" fill="currentColor" />
    </svg>
  );
}

export function CiderLogo() {
  return (
    <span className="inline-flex items-center gap-2 text-fd-foreground">
      <CiderMark size={18} />
      <span
        className="font-extrabold"
        style={{ fontSize: 19, letterSpacing: '-0.7px', lineHeight: 1 }}
      >
        cider<span style={{ color: '#ff8200' }}>.</span>
      </span>
    </span>
  );
}
