// Deploys da Vercel (etapa 19): webhook assinado com HMAC-SHA1 (x-vercel-signature).
// Guardamos só estado, ambiente, commit e link do deploy, nunca logs.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedEvent } from "./normalized.ts";
import type { Verification } from "./signatures.ts";

export function verifyVercel(secret: string, rawBody: string, headers: Record<string, string | undefined>): Verification {
  const sig = headers["x-vercel-signature"];
  if (!sig) return { ok: false, reason: "assinatura ausente" };
  const expected = Buffer.from(createHmac("sha1", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "assinatura inválida" };
}

export const signVercel = (secret: string, body: string) => ({ "x-vercel-signature": createHmac("sha1", secret).update(body).digest("hex") });

/** Time (ou conta) da Vercel que enviou o aviso: aponta para a empresa em installation_routes. */
export const vercelRouteKey = (body: any): string | undefined => body?.payload?.team?.id ?? body?.payload?.user?.id ?? undefined;

const STATE: Record<string, "building" | "ready" | "error" | "canceled"> = {
  "deployment.created": "building",
  "deployment.succeeded": "ready",
  "deployment.ready": "ready",
  "deployment.promoted": "ready",
  "deployment.error": "error",
  "deployment.canceled": "canceled",
};

export function normalizeVercel(body: any): NormalizedEvent[] {
  const state = STATE[body?.type];
  const d = body?.payload?.deployment;
  if (!state || !d?.id) return [{ kind: "ignored", reason: `vercel ${body?.type ?? "?"} não usado` }];
  const meta = d.meta ?? {};
  const repository = meta.githubOrg && meta.githubRepo ? `${meta.githubOrg}/${meta.githubRepo}` : undefined;
  return [{
    kind: "deployment",
    deployment: {
      provider: "vercel",
      externalId: d.id,
      repository,
      sha: meta.githubCommitSha,
      branch: meta.githubCommitRef,
      environment: body.payload.target === "production" ? "production" : "preview",
      state,
      url: d.url ? (String(d.url).startsWith("http") ? d.url : `https://${d.url}`) : undefined,
      at: new Date(body.createdAt ?? Date.now()),
    },
  }];
}
