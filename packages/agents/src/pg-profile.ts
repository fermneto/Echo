// Personalização do agente pela própria pessoa: o jeito de responder e a delegação, em texto livre.
// Só a pessoa grava o próprio texto (o painel confere quem está logado). Tudo passa por cleanAgentText.
import { type Database, fixRuns, people, pullRequests, reviews, withOrg } from "@echo/db";
import { cleanAgentText, type PlanFix } from "@echo/domain";
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { createPgFixStore } from "./pg-fix.ts";

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

/** O que o agente fez com uma correção do PR da pessoa, olhando a delegação dela. */
export interface AgentDecision {
  fixId: string;
  repository: string;
  prNumber: number;
  draftPrNumber: number | null;
  /** unida: o agente uniu pela delegação; com_voce: a delegação não cobriu e a correção ficou com a pessoa. */
  outcome: "unida" | "com_voce";
  /** Estado atual da correção (pronta, aprovada, aplicada, recusada…), para a tela dizer se ainda espera. */
  state: string;
  note: string;
  at: Date;
}

/**
 * Decisões do agente sobre as correções dos PRs da pessoa: as que ele uniu pela delegação e as que deixou com
 * ela, com o motivo. Mais recentes primeiro.
 */
export async function readAgentDecisions(db: Database, orgId: string, personId: string, limit = 10): Promise<AgentDecision[]> {
  const rows = await withOrg(db, orgId, (tx) =>
    tx
      .select({ f: fixRuns, p: pullRequests })
      .from(fixRuns)
      .innerJoin(reviews, and(eq(reviews.id, fixRuns.reviewId), eq(reviews.orgId, orgId)))
      .innerJoin(pullRequests, and(eq(pullRequests.id, reviews.prId), eq(pullRequests.orgId, orgId)))
      .where(and(eq(fixRuns.orgId, orgId), eq(pullRequests.authorId, personId), or(eq(fixRuns.decidedVia, "delegacao"), isNotNull(fixRuns.delegationNote))))
      .orderBy(desc(fixRuns.createdAt))
      .limit(limit),
  );
  return rows.map(({ f, p }) => ({
    fixId: f.id,
    repository: p.repository,
    prNumber: p.number,
    draftPrNumber: f.draftPrNumber ?? null,
    outcome: f.decidedVia === "delegacao" ? "unida" : "com_voce",
    state: f.state,
    note: f.delegationNote ?? "",
    at: f.decidedAt ?? f.createdAt,
  }));
}

/** Correções prontas esperando a pessoa em Meu plano, com o motivo de a delegação não ter coberto. */
export function readPlanFixes(db: Database, orgId: string, personId: string): Promise<PlanFix[]> {
  return createPgFixStore(db, orgId).fixesForAuthor(personId);
}
