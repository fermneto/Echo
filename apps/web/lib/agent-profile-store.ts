import type { Database } from "@echo/db";
import { cleanAgentText } from "@echo/domain";
import { cookies } from "next/headers";
import { personIdFor } from "./agent";
import { type DecisionView, type DemoProfile, demoDecisions, parseProfile, PROFILE_COOKIE } from "./demo/agent-profile";
import { gainsOrgId, isDemoOrg } from "./gains";

/** "Seu agente" na demonstração sem banco: o texto fica só no navegador de quem visita. */
export async function currentDemoProfile(): Promise<DemoProfile> {
  return parseProfile((await cookies()).get(PROFILE_COOKIE)?.value);
}

/** Grava limpo, como no banco; a data da delegação só muda quando o texto muda. */
export async function saveDemoProfile(input: { style: string; delegation: string }, at: Date): Promise<void> {
  const jar = await cookies();
  const cur = parseProfile(jar.get(PROFILE_COOKIE)?.value);
  const style = cleanAgentText(input.style) ?? "";
  const delegation = cleanAgentText(input.delegation) ?? "";
  const delegationAtIso = delegation === cur.delegation ? cur.delegationAtIso : delegation ? at.toISOString() : null;
  jar.set(PROFILE_COOKIE, JSON.stringify({ style, delegation, delegationAtIso }), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
}

/** `decisions: null`: a leitura das decisões falhou; o formulário aparece e a lista avisa. */
export type OwnAgent = { style: string; delegation: string; delegationAt: Date | null; decisions: DecisionView[] | null; demo: boolean };

/**
 * `indisponivel`: a leitura do próprio texto falhou. A ficha abre sem o formulário: um formulário vazio, se salvo,
 * apagaria o estilo e a delegação gravados.
 */
export type OwnAgentLoad = { status: "ok"; agent: OwnAgent } | { status: "indisponivel" };

type ProfileReader = Pick<typeof import("@echo/agents/perfil"), "readAgentProfile" | "readAgentDecisions">;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * "Seu agente" da própria pessoa: do banco quando há; senão, para a persona da demonstração, o texto do cookie e
 * decisões de exemplo. Empresa conectada sem banco: vazio, nunca as decisões de exemplo.
 * Falha na leitura não derruba a ficha: o bloco fica indisponível (texto) ou sem a lista (decisões).
 */
export async function loadOwnAgent(me: { id: string; orgId: string }, db: Database | null, deps: { read?: ProfileReader } = {}): Promise<OwnAgentLoad> {
  if (!db && !isDemoOrg(me.orgId)) return { status: "ok", agent: { style: "", delegation: "", delegationAt: null, decisions: [], demo: false } };
  if (!db) {
    const p = await currentDemoProfile();
    return { status: "ok", agent: { style: p.style, delegation: p.delegation, delegationAt: p.delegationAtIso ? new Date(p.delegationAtIso) : null, decisions: demoDecisions(me.id), demo: true } };
  }
  const [orgId, personId] = [gainsOrgId(me.orgId), personIdFor(me.id)];
  let read: ProfileReader;
  try {
    read = deps.read ?? (await import("@echo/agents/perfil"));
  } catch (err) {
    console.error("seu agente indisponível", errorMessage(err));
    return { status: "indisponivel" };
  }
  const [profile, decisions] = await Promise.allSettled([read.readAgentProfile(db, orgId, personId), read.readAgentDecisions(db, orgId, personId)]);
  if (profile.status === "rejected") {
    console.error("seu agente indisponível", errorMessage(profile.reason));
    return { status: "indisponivel" };
  }
  if (decisions.status === "rejected") console.error("decisões do agente indisponíveis", errorMessage(decisions.reason));
  const p = profile.value;
  return {
    status: "ok",
    agent: {
      style: p?.style ?? "",
      delegation: p?.delegation ?? "",
      delegationAt: p?.delegationUpdatedAt ?? null,
      decisions: decisions.status === "fulfilled" ? decisions.value.map(({ at, ...d }) => ({ ...d, atIso: at.toISOString() })) : null,
      demo: false,
    },
  };
}
