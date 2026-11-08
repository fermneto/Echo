// Conferências puras do executor, feitas antes de qualquer chamada ao GitHub, e a linha de auditoria da
// aprovação. Sem banco: testadas sem Postgres.
import { checkFixDiff, fixDraftBranchCheck } from "@echo/domain";
import type { ActionType } from "./index.ts";

/** Onde a pessoa aprovou: botão no Slack ou o painel. */
export type ApprovalSource = "slack" | "painel";

/** Carga do rascunho da correção (github.draft_pr). */
export interface DraftPrPayload {
  repo: string;
  prNumber: number;
  base: string;
  baseSha: string;
  branch: string;
  title: string;
  body: string;
  patch: string;
  /** Arquivos do PR na versão analisada: o diff é conferido de novo contra eles na hora de escrever. */
  prFiles?: string[];
  draft?: boolean;
}

/**
 * O rascunho não exige aprovação e escreve com força na branch se ela já existir. Por isso, na hora de executar:
 * a branch tem de ser `echo/fix-pr-N` deste PR (nunca a base nem a padrão) e o diff tem de passar de novo pela
 * mesma conferência do fluxo. Devolve o motivo da recusa, ou null.
 */
export function draftPrRefusal(p: DraftPrPayload): string | null {
  const branch = fixDraftBranchCheck({ branch: p.branch, base: p.base, prNumber: p.prNumber });
  if (!branch.ok) return `branch recusada: ${branch.reason}`;
  if (!Array.isArray(p.prFiles)) return "diff recusado: a ação não traz os arquivos do PR para conferir";
  const check = checkFixDiff(p.patch, p.prFiles);
  if (!check.ok) return `diff recusado: ${check.reasons.join("; ")}`;
  return null;
}

/** Linha do `audit_log` de uma aprovação humana: quem (person:<id>), o quê e por onde. */
export function approvalAudit(input: { orgId: string; approverId: string; type: ActionType | string; target: string; source?: ApprovalSource }): { orgId: string; actor: string; action: string; target: string } {
  return {
    orgId: input.orgId,
    actor: `person:${input.approverId}`,
    action: `approve:${input.type}${input.source ? `:${input.source}` : ""}`,
    target: input.target,
  };
}
