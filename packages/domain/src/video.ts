// Trechos de tela do vídeo da semana (etapa 27): regras puras. Quais entregas ganham trecho, quais telas o PR mexe
// e o que um roteiro pode conter. O modelo só escreve o roteiro; tudo aqui decide por regra, sem rede, modelo nem
// relógio do sistema.
import type { PullRequest } from "./types.ts";

export const VIDEO_RULES = {
  /** Trechos de tela por vídeo da semana. */
  maxPerReport: 3,
  maxSeconds: 90,
  maxSteps: 12,
  maxCaptionChars: 120,
} as const;

/** Arquivos de tela: o que muda o que alguém vê. Testes, histórias e estilos isolados de teste não contam. */
const UI_FILE = /(^|\/)(app|pages|components|views|screens|ui)\/.+\.(tsx|jsx|vue|svelte)$|\.(tsx|jsx|vue|svelte)$/;
const NOT_UI = /(\.test\.|\.spec\.|\.stories\.|__tests__\/|(^|\/)e2e\/)/;

export function changesScreen(files: readonly string[]): boolean {
  return files.some((f) => UI_FILE.test(f) && !NOT_UI.test(f));
}

/**
 * Telas que o PR mexe, pelo roteamento de arquivos do Next.js (app/ e pages/): "app/(painel)/equipe/page.tsx"
 * vira "/equipe". Grupos entre parênteses somem; rota com parâmetro ([id]) fica de fora (não há como adivinhar o valor).
 */
export function screensFromFiles(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const app = f.match(/(?:^|\/)app\/(.*?)\/?page\.(?:tsx|jsx|ts|js)$/);
    const pages = f.match(/(?:^|\/)pages\/(?!api\/|_)(.*?)\.(?:tsx|jsx)$/);
    const raw = app ? app[1]! : pages ? pages[1]!.replace(/(^|\/)index$/, "") : null;
    if (raw === null) continue;
    const parts = raw.split("/").filter((p) => p && !/^\(.*\)$/.test(p) && !p.startsWith("@"));
    if (parts.some((p) => p.startsWith("["))) continue;
    out.add("/" + parts.join("/"));
  }
  return [...out].slice(0, 6);
}

/** Preview pronto de um commit (deployments da etapa 19). Só ambiente de preview, nunca produção. */
export interface PreviewDeployment {
  repository?: string | undefined;
  sha?: string | undefined;
  environment: string;
  state: string;
  url?: string | undefined;
}

export interface VideoCandidate {
  pr: PullRequest;
  previewUrl: string;
}

/**
 * Entregas da semana que ganham vídeo: PR unido da pessoa no período, que mudou tela e tem preview pronto do
 * último commit. As mais recentes primeiro, até `maxPerReport`. Sem preview, a entrega fica só no texto.
 */
export function pickVideoDeliveries(
  personId: string,
  prs: readonly PullRequest[],
  deployments: readonly PreviewDeployment[],
  period: { from: Date; to: Date },
): VideoCandidate[] {
  const out: VideoCandidate[] = [];
  const merged = prs
    .filter((p) => p.authorId === personId && p.state === "merged" && p.mergedAt && p.mergedAt >= period.from && p.mergedAt < period.to && p.headSha && changesScreen(p.files))
    .sort((a, b) => b.mergedAt!.getTime() - a.mergedAt!.getTime());
  for (const pr of merged) {
    const dep = deployments.find((d) => d.sha === pr.headSha && d.environment === "preview" && d.state === "ready" && d.url && (!d.repository || d.repository === pr.repository));
    const url = dep?.url ? previewOrigin(dep.url) : null;
    if (!url) continue;
    out.push({ pr, previewUrl: url });
    if (out.length >= VIDEO_RULES.maxPerReport) break;
  }
  return out;
}

/** Origem https do preview ("abc.vercel.app" ou "https://abc.vercel.app/x" viram "https://abc.vercel.app"). */
export function previewOrigin(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

// ---------- Roteiro

export type VideoStep =
  | { action: "goto"; url: string; caption: string }
  | { action: "click"; target: string; caption: string }
  | { action: "fill"; target: string; value: string; caption: string }
  | { action: "press"; key: string; caption: string }
  | { action: "wait"; seconds: number; caption: string };

export interface VideoScript {
  /** Endereço inicial, no preview. */
  startUrl: string;
  /** Título curto do vídeo, em terceira pessoa. */
  title: string;
  steps: VideoStep[];
}

const FIRST_PERSON = /\b(eu|meu|minha|meus|minhas|fiz|criei|implementei|corrigi|mudei|ajustei|adicionei|nós|nosso|nossa)\b/i;
const DIGITS = /\d+([.,]\d+)?/g;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Host permitido: o do preview da entrega ou localhost (app subido no commit com o seed). Nunca produção. */
function allowedUrl(url: string, previewHost: string): boolean {
  try {
    const u = new URL(url);
    if (LOCAL_HOSTS.has(u.hostname)) return u.protocol === "http:" || u.protocol === "https:";
    return u.protocol === "https:" && u.hostname === previewHost;
  } catch {
    return false;
  }
}

/**
 * Confere o roteiro antes de qualquer gravação. Devolve a lista de problemas (vazia: pode gravar).
 * `allowedTokens`: números e identificadores que podem aparecer nas legendas (ex.: o número do PR, "ECH-131").
 */
export function scriptIssues(raw: unknown, ctx: { previewUrl: string; allowedTokens: readonly string[] }): string[] {
  const issues: string[] = [];
  const s = raw && typeof raw === "object" ? (raw as Partial<VideoScript>) : {};
  let previewHost = "";
  try {
    previewHost = new URL(ctx.previewUrl).hostname;
  } catch {
    return ["preview sem endereço válido"];
  }
  if (typeof s.title !== "string" || !s.title.trim()) issues.push("roteiro sem título");
  if (typeof s.startUrl !== "string" || !allowedUrl(s.startUrl, previewHost)) issues.push("endereço inicial fora do preview");
  if (!Array.isArray(s.steps) || s.steps.length === 0) return [...issues, "roteiro sem passos"];
  if (s.steps.length > VIDEO_RULES.maxSteps) issues.push(`mais de ${VIDEO_RULES.maxSteps} passos`);

  const allowed = new Set(ctx.allowedTokens.flatMap((t) => t.match(DIGITS) ?? []));
  const texts = [s.title ?? "", ...s.steps.map((st) => (st && typeof st === "object" && "caption" in st ? String(st.caption ?? "") : ""))];
  let waited = 0;
  s.steps.forEach((st, i) => {
    const n = i + 1;
    if (!st || typeof st !== "object") return void issues.push(`passo ${n} inválido`);
    const caption = typeof st.caption === "string" ? st.caption.trim() : "";
    if (!caption) issues.push(`passo ${n} sem legenda`);
    if (caption.length > VIDEO_RULES.maxCaptionChars) issues.push(`legenda do passo ${n} longa demais`);
    switch (st.action) {
      case "goto":
        if (typeof st.url !== "string" || !allowedUrl(st.url, previewHost)) issues.push(`passo ${n} sai do preview`);
        break;
      case "click":
        if (typeof st.target !== "string" || !st.target.trim()) issues.push(`passo ${n} sem alvo`);
        break;
      case "fill":
        if (typeof st.target !== "string" || !st.target.trim() || typeof st.value !== "string") issues.push(`passo ${n} sem alvo ou valor`);
        break;
      case "press":
        if (typeof st.key !== "string" || !/^[A-Za-z0-9+]{1,20}$/.test(st.key)) issues.push(`passo ${n} com tecla inválida`);
        break;
      case "wait":
        if (typeof st.seconds !== "number" || st.seconds <= 0 || st.seconds > 10) issues.push(`passo ${n} com espera inválida`);
        else waited += st.seconds;
        break;
      default:
        issues.push(`passo ${n} com ação desconhecida`);
    }
  });
  if (waited > VIDEO_RULES.maxSeconds / 2) issues.push("espera demais para um vídeo curto");
  for (const t of texts) {
    if (FIRST_PERSON.test(t)) {
      issues.push("legenda na primeira pessoa");
      break;
    }
  }
  const stray = texts.flatMap((t) => t.match(DIGITS) ?? []).filter((d) => !allowed.has(d));
  if (stray.length) issues.push(`número fora dos identificadores: ${[...new Set(stray)].join(", ")}`);
  return issues;
}
