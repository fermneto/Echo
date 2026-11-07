import type { ReactNode } from "react";

export const metadata = { title: "Echo", description: "Gêmeos digitais para equipes distribuídas" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f3f7f8", color: "#14282f" }}>{children}</body>
    </html>
  );
}
