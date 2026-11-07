export default function Home() {
  return (
    <main style={{ maxWidth: "var(--width-app)", margin: "0 auto", padding: "40px var(--space-gutter) 120px" }}>
      <h1 style={{ fontSize: 44, fontWeight: 400, lineHeight: 1.07, letterSpacing: "-0.31px", margin: 0 }}>
        echo<span style={{ color: "var(--color-signal-on)" }}>.</span>
      </h1>
      <p style={{ fontSize: 18, lineHeight: 1.45, color: "var(--color-fog)", maxWidth: "64ch" }}>
        O trabalho continua quando a pessoa não está.
      </p>
      <p className="mono" style={{ color: "var(--color-ash)", textTransform: "uppercase" }}>
        Painel em construção
      </p>
    </main>
  );
}
