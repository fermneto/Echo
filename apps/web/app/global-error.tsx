"use client";

/** Última rede: a própria base da página falhou, então não há CSS do site nem fontes para usar. */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#0a0a0a", color: "#fafafa", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 480 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 500 }}>O Echo não carregou.</h1>
          <p style={{ color: "#a1a1a1", lineHeight: 1.5 }}>Pode ser uma falha passageira. Tente de novo em instantes.</p>
          <button type="button" onClick={reset} style={{ minHeight: 40, padding: "8px 20px", border: 0, borderRadius: 999, background: "#fafafa", color: "#101010", font: "inherit", cursor: "pointer" }}>
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
