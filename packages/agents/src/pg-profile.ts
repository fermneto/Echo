// Personalização do agente pela própria pessoa: o jeito de responder e a delegação, em texto livre.
// Só a pessoa grava o próprio texto (o painel confere quem está logado). Tudo passa por cleanAgentText.
import { type Database, people, withOrg } from "@echo/db";
import { cleanAgentText } from "@echo/domain";
import { and, eq, isNull } from "drizzle-orm";

export interface AgentProfile {
  style: string | null;
  delegation: string | null;
  delegationUpdatedAt: Date | null;
}

export async function readAgentProfile(db: Database, orgId: string, personId: string): Promise<AgentProfile | null> {
  const [p] = await withOrg(db, orgId, (tx) =>
    tx
      .select({ style: people.agentStyle, delegation: people.delegation, at: people.delegationUpdatedAt })
      .from(people)
      .where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt))),
  );
  return p ? { style: cleanAgentText(p.style), delegation: cleanAgentText(p.delegation), delegationUpdatedAt: p.at ?? null } : null;
}

/**
 * Grava os dois textos. A data da delegação muda só quando o texto dela muda: a decisão tomada pelo agente
 * cita essa versão. Devolve false se a pessoa não existe nesta empresa.
 */
export async function saveAgentProfile(db: Database, orgId: string, personId: string, input: { style: string; delegation: string }, at: Date): Promise<boolean> {
  const style = cleanAgentText(input.style);
  const delegation = cleanAgentText(input.delegation);
  return withOrg(db, orgId, async (tx) => {
    const [cur] = await tx
      .select({ delegation: people.delegation })
      .from(people)
      .where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt)))
      .for("update");
    if (!cur) return false;
    const changed = cleanAgentText(cur.delegation) !== delegation;
    await tx
      .update(people)
      .set({ agentStyle: style, delegation, ...(changed ? { delegationUpdatedAt: delegation ? at : null } : {}) })
      .where(and(eq(people.orgId, orgId), eq(people.id, personId)));
    return true;
  });
}
