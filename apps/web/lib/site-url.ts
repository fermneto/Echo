import { loadConfig } from "@echo/config";

/** Endereço público do site, sem barra no fim. Lido na requisição: no build da imagem, PANEL_URL ainda não existe. */
export function siteUrl(): string {
  return (loadConfig("web").PANEL_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
