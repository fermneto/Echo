import { ImageResponse } from "next/og";

/** Ícone para a tela inicial do iPhone: o mesmo ponto com ondas do favicon, em PNG. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
        <svg width="180" height="180" viewBox="0 0 512 512">
          <g fill="none" stroke="#98ff38" strokeLinecap="round">
            <path d="M124.5 407.5A186 186 0 1 1 387.5 407.5" strokeWidth="22" opacity="0.5" />
            <path d="M169.7 362.3A122 122 0 1 1 342.3 362.3" strokeWidth="30" />
          </g>
          <circle cx="256" cy="276" r="54" fill="#98ff38" />
        </svg>
      </div>
    ),
    size,
  );
}
