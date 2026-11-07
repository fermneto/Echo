import type { Database } from "@echo/db";
import { cleanAgentText } from "@echo/domain";
import { cookies } from "next/headers";
import { personIdFor } from "./agent";
import { type DecisionView, type DemoProfile, demoDecisions, parseProfile, PROFILE_COOKIE } from "./demo/agent-profile";
import { gainsOrgId } from "./gains";

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

export type OwnAgent = { style: string; delegation: string; delegationAt: Date | null; decisions: DecisionView[]; demo: boolean };

/** "Seu agente" da própria pessoa: do banco quando há; senão, o texto do cookie e decisões de exemplo. */
export async function loadOwnAgent(me: { id: string; orgId: string }, db: Database | null): Promise<OwnAgent> {
  if (!db) {
    const p = await currentDemoProfile();
    return { style: p.style, delegation: p.delegation, delegationAt: p.delegationAtIso ? new Date(p.delegationAtIso) : null, decisions: demoDecisions(me.id), demo: true };
  }
  const { readAgentDecisions, readAgentProfile } = await import("@echo/agents/perfil");
  const [orgId, personId] = [gainsOrgId(me.orgId), personIdFor(me.id)];
  const [p, decisions] = await Promise.all([readAgentProfile(db, orgId, personId), readAgentDecisions(db, orgId, personId)]);
  return {
    style: p?.style ?? "",
    delegation: p?.delegation ?? "",
    delegationAt: p?.delegationUpdatedAt ?? null,
    decisions: decisions.map(({ at, ...d }) => ({ ...d, atIso: at.toISOString() })),
    demo: false,
  };
}
