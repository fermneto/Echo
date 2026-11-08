"use server";

import { loadConfig } from "@echo/config";
import { revalidatePath } from "next/cache";
import { panelDb } from "@/lib/db";
import { panelIds } from "@/lib/redistribution-server";
import { requireAccess } from "@/lib/session";
import type { FixDecisionView } from "./PlanList";

const REFUSED: Record<string, string> = {
  so_o_autor: "Só quem abriu o PR decide esta correção.",
  nao_esta_pronta: "A correção ainda não está pronta para decidir.",
  rascunho_mudou: "O rascunho mudou depois de pronto. Nada foi unido; confira o rascunho no GitHub.",
  rascunho_fechado: "O rascunho foi fechado no GitHub. Nada foi unido.",
  pr_fechado: "O PR original não está mais aberto. Nada foi unido.",
};

/**
 * Meu plano: o autor aprova ou recusa a correção da revisão noturna. Aprovar confere o rascunho no GitHub na
 * hora e põe a união no outbox com a aprovação dele registrada; o executor confere de novo antes de unir.
 */
export async function decidirCorrecao(fixId: string, decision: "approve" | "decline"): Promise<FixDecisionView> {
  const me = await requireAccess("plano");
  const db = panelDb();
  if (!db) return { final: false, message: "Demonstração sem banco: nada foi decidido." };
  const cfg = loadConfig("web");
  const { orgId, personId } = panelIds(me);
  const [{ serverFix }, { githubForOrg, platformsFromEnv }] = await Promise.all([import("@echo/agents/server"), import("@echo/connectors")]);
  const gh = decision === "approve" ? await githubForOrg(db, platformsFromEnv(cfg), orgId) : undefined;
  const host = gh ?? null;
  const r = await serverFix(db, { codeHost: () => host }).decide(orgId, personId, fixId, decision);
  revalidatePath("/plano");
  switch (r.status) {
    case "approved":
      return { final: true, message: "Aprovada por você. A união no seu PR entrou na fila; o rascunho é conferido de novo antes de unir." };
    case "declined":
      return { final: true, message: "Recusada por você. Nada foi unido; o rascunho fica no GitHub para você fechar." };
    case "conflict":
      return { final: true, message: "Esta correção já tinha sido decidida." };
    case "not_found":
      return { final: true, message: "Correção não encontrada." };
    case "denied":
      return { final: true, message: REFUSED.so_o_autor! };
    case "unavailable":
      return { final: false, message: "O GitHub não está ligado no painel (GITHUB_APP_ID). Nada foi decidido." };
    case "refused":
      return { final: true, message: REFUSED[r.reason] ?? "A correção não pôde ser unida." };
  }
}
