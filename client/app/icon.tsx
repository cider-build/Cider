import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 7,
          background: "#0F172A",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="20"
          height="18"
          viewBox="0 0 210 190"
          fill="none"
        >
          <rect x="60" y="0" width="120" height="50" rx="25" fill="#ffffff" />
          <rect x="0" y="70" width="110" height="50" rx="25" fill="#ffffff" />
          <rect x="130" y="70" width="80" height="50" rx="25" fill="#FF8200" />
          <rect x="60" y="140" width="120" height="50" rx="25" fill="#ffffff" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
