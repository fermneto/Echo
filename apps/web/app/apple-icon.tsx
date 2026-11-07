import { ImageResponse } from "next/og";

/** Ícone para a tela inicial do iPhone: o símbolo do eco (pessoa em verde, gêmeo em azul), em PNG. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#161616" }}>
        <svg width="180" height="180" viewBox="0 0 512 512">
          <path d="M86 341A170 170 0 0 1 256 171L256 213A128 128 0 0 0 128 341Z" fill="#98ff38" />
          <path d="M256 171A170 170 0 0 1 426 341L384 341A128 128 0 0 0 256 213Z" fill="#4d8dff" />
          <path d="M148 341A108 108 0 0 1 256 233L256 275A66 66 0 0 0 190 341Z" fill="#98ff38" />
          <path d="M256 233A108 108 0 0 1 364 341L322 341A66 66 0 0 0 256 275Z" fill="#4d8dff" />
          <path d="M210 341A46 46 0 0 1 302 341A46 30 0 0 0 210 341Z" fill="#98ff38" />
        </svg>
      </div>
    ),
    size,
  );
}
