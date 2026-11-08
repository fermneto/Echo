import { createHmac, timingSafeEqual } from "node:crypto";

/** Resultado de uma verificação de webhook. `reason` vai para log, nunca para a resposta. */
export type Verification = { ok: true } | { ok: false; reason: string };

const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

type Headers = Record<string, string | undefined>;
const h = (headers: Headers, name: string) => headers[name] ?? headers[name.toLowerCase()];

/** GitHub: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo). */
export function verifyGithub(secret: string, rawBody: string, headers: Headers): Verification {
  const sig = h(headers, "x-hub-signature-256");
  if (!sig?.startsWith("sha256=")) return { ok: false, reason: "assinatura ausente" };
  return safeEqual(sig, `sha256=${hmacHex(secret, rawBody)}`) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}

/** Slack: X-Slack-Signature = "v0=" + HMAC-SHA256("v0:<timestamp>:<corpo>"), timestamp em até 5 minutos. */
export function verifySlack(secret: string, rawBody: string, headers: Headers, nowMs: number, toleranceS = 300): Verification {
  const ts = h(headers, "x-slack-request-timestamp");
  const sig = h(headers, "x-slack-signature");
  if (!ts || !sig) return { ok: false, reason: "assinatura ausente" };
  if (!/^\d+$/.test(ts) || Math.abs(nowMs / 1000 - Number(ts)) > toleranceS) return { ok: false, reason: "timestamp fora da janela" };
  return safeEqual(sig, `v0=${hmacHex(secret, `v0:${ts}:${rawBody}`)}`) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}

/** Linear: Linear-Signature = HMAC-SHA256(corpo) em hex; webhookTimestamp (ms) do corpo em até 60 s. */
export function verifyLinear(secret: string, rawBody: string, headers: Headers, nowMs: number, toleranceMs = 60_000): Verification {
  const sig = h(headers, "linear-signature");
  if (!sig) return { ok: false, reason: "assinatura ausente" };
  if (!safeEqual(sig, hmacHex(secret, rawBody))) return { ok: false, reason: "assinatura inválida" };
  try {
    const ts = (JSON.parse(rawBody) as { webhookTimestamp?: number }).webhookTimestamp;
    if (typeof ts === "number" && Math.abs(nowMs - ts) > toleranceMs) return { ok: false, reason: "timestamp fora da janela" };
  } catch {
    return { ok: false, reason: "corpo não é JSON" };
  }
  return { ok: true };
}

/**
 * Jira Cloud (webhook com segredo): X-Hub-Signature = "sha256=" + HMAC-SHA256(corpo) em hex, como no WebSub.
 * O Jira não manda horário assinado; a repetição é barrada pelo X-Atlassian-Webhook-Identifier (único por entrega).
 * Outro algoritmo é recusado, para não aceitar um formato que não sabemos conferir.
 */
export function verifyJira(secret: string, rawBody: string, headers: Headers): Verification {
  const sig = h(headers, "x-hub-signature");
  if (!sig) return { ok: false, reason: "assinatura ausente" };
  if (!sig.startsWith("sha256=")) return { ok: false, reason: "algoritmo não suportado" };
  return safeEqual(sig, `sha256=${hmacHex(secret, rawBody)}`) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}

/** Aviso de RH: x-echo-signature = HMAC-SHA256("<timestamp>.<corpo>") em hex; mais de 5 minutos é recusado. */
export function verifyHr(secret: string, rawBody: string, headers: Headers, nowMs: number, toleranceS = 300): Verification {
  const ts = h(headers, "x-echo-timestamp");
  const sig = h(headers, "x-echo-signature");
  if (!ts || !sig) return { ok: false, reason: "assinatura ausente" };
  if (!/^\d+$/.test(ts) || Math.abs(nowMs / 1000 - Number(ts)) > toleranceS) return { ok: false, reason: "timestamp fora da janela" };
  return safeEqual(sig, hmacHex(secret, `${ts}.${rawBody}`)) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}

/** Utilitários para testes e para o simulador assinar as próprias chamadas. */
export const sign = {
  github: (secret: string, body: string) => ({ "x-hub-signature-256": `sha256=${hmacHex(secret, body)}` }),
  slack: (secret: string, body: string, tsS: number) => ({
    "x-slack-request-timestamp": String(tsS),
    "x-slack-signature": `v0=${hmacHex(secret, `v0:${tsS}:${body}`)}`,
  }),
  linear: (secret: string, body: string) => ({ "linear-signature": hmacHex(secret, body) }),
  jira: (secret: string, body: string) => ({ "x-hub-signature": `sha256=${hmacHex(secret, body)}` }),
  hr: (secret: string, body: string, tsS: number) => ({ "x-echo-timestamp": String(tsS), "x-echo-signature": hmacHex(secret, `${tsS}.${body}`) }),
};
