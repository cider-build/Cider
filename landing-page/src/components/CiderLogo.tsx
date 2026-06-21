import CiderIcon from "./CiderIcon";

interface Props {
  className?: string;
  iconSize?: number;
}

export default function CiderLogo({ className, iconSize = 32 }: Props) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 14 }}
    >
      <CiderIcon size={iconSize} />
      <span
        style={{
          fontSize: iconSize * 1.1,
          fontWeight: 800,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: "#0F172A",
        }}
      >
        cider
        <span style={{ color: "#FF8200" }}>.build</span>
      </span>
    </div>
  );
}
