import type { ReactNode } from "react";
import { Geist, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./painel.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata = { title: "Echo", description: "Gêmeos digitais para equipes distribuídas" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${geist.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
