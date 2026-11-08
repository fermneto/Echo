import { ImageResponse } from "next/og";

export const dynamic = "force-static";

/** Prévia do link em Slack, WhatsApp e redes (1200×630). */
export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#0a0a0a", color: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "flex-end", fontSize: 56, fontWeight: 700, letterSpacing: -2 }}>
          echo
          <div style={{ width: 14, height: 14, marginBottom: 14, marginLeft: 4, background: "#98ff38" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.04, letterSpacing: -3, maxWidth: 980 }}>A resposta não precisa esperar até amanhã.</div>
          <div style={{ marginTop: 32, fontSize: 34, color: "#a1a1a1" }}>Um agente para cada pessoa da equipe, entre fusos e ausências.</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
