interface Props {
  className?: string;
  size?: number;
}

export default function CiderIcon({ className, size = 24 }: Props) {
  const aspectRatio = 210 / 190;
  const width = size * aspectRatio;

  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 210 190"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="60" y="0" width="120" height="50" rx="25" fill="#0F172A" />
      <rect x="0" y="70" width="110" height="50" rx="25" fill="#0F172A" />
      <rect x="130" y="70" width="80" height="50" rx="25" fill="#FF8200" />
      <rect x="60" y="140" width="120" height="50" rx="25" fill="#0F172A" />
    </svg>
  );
}
