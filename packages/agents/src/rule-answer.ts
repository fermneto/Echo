// Resposta por regra, sem modelo (etapa 6): quando a API falha, o validador recusa, o modelo recusa
// ou o teto de custo é atingido. Só repete o que está registrado, com as mesmas ferramentas de leitura.
import type { AnswerOutput } from "./index.ts";
import { canSeePr, findPerson, firstName, getBranchStatus, type ToolContext } from "./tools.ts";

const TASK_STATE: Record<string, string> = {
  backlog: "no backlog",
  todo: "a fazer",
  in_progress: "em andamento",
  in_review: "em revisão",
  done: "concluída",
  canceled: "cancelada",
};
const PR_STATE: Record<string, string> = { open: "aberto", draft: "em rascunho", merged: "incorporado", closed: "fechado" };

const EVALUATION = /(?<!\p{L})(bom|boa|[óo]tim[oa]|ruim|melhor|pior)\s+(funcion[áa]ri|profissional|colega)|promo[çc]|demiss|demitir|sal[áa]ri|aumento|ranking|desempenho|avali[ae]/iu;
const APPROVAL = /(?<!\p{L})(aprov|merge|publi(?:car|que|ca)(?!\p{L})|produ[çc][ãa]o|deploy)/iu;
const REASSIGN = /(?<!\p{L})(atribu|reatribu|transfer|redistribu|assum(?:ir|a) (?:as|todas))/iu;

const BRANCH = /(?<![\w-])([a-z][a-z0-9]*-\d+-[a-z0-9][a-z0-9-]*)(?![\w-])/gi;
const TASK_KEY = /(?<![\w-])([A-Za-z][A-Za-z0-9]*-\d+)(?![\w-])/g;
const PR_NUMBER = /(?<!\p{L})PR\s*(?:#|n[ºo°]?\s*)?(\d+)/giu;

/** Resposta do teto de custo para a pergunta livre ao Echo (pausada a 100% do limite). */
export const ECHO_PAUSED: AnswerOutput = {
  status: "recusado",
  texto: "As perguntas livres ao Echo estão pausadas porque o limite de custo do mês foi atingido. Os agentes de quem está ausente seguem respondendo.",
  fontes: [],
  liberacao: null,
  precisa_do_dono: false,
};

export async function ruleAnswer(ctx: ToolContext, question: string): Promise<AnswerOutput> {
  const ownerName = ctx.owner ? firstName(ctx.owner) : undefined;
  const asker = firstName(ctx.asker);
  const who = ownerName ? `O agente de ${ownerName}` : "O Echo";
  const refuse = (texto: string): AnswerOutput => ({ status: "recusado", texto, fontes: [], liberacao: null, precisa_do_dono: false });

  if (EVALUATION.test(question)) return refuse(`${who} não avalia pessoas, não dá notas nem compara colegas.`);
  if (APPROVAL.test(question)) return refuse(`${who} não aprova PRs nem publica em produção: essa decisão é sempre de uma pessoa.`);
  if (REASSIGN.test(question)) return refuse(`${who} não muda tarefas; a redistribuição passa por aprovação da liderança no painel.`);

  const sentences: string[] = [];
  const fontes: string[] = [];
  let liberacao: AnswerOutput["liberacao"] = null;
  let needsOwner = false;

  const branches = [...new Set([...question.matchAll(BRANCH)].map((m) => m[1]!.toLowerCase()))];
  for (const branch of branches) {
    const r = await getBranchStatus(ctx, branch);
    if (!("estado" in r)) {
      sentences.push(`A ${branch} existe em mais de um repositório; vale dizer qual.`);
      continue;
    }
    fontes.push(...r.fontes);
    const dono = r.dono ?? ownerName ?? "a pessoa responsável";
    switch (r.estado) {
      case "released":
        if (r.liberada_para_quem_pergunta) {
          sentences.push(`A ${branch} está liberada para ${asker} na nota do dia confirmada de ${dono}.`);
          liberacao ??= { alvo: branch, tipo: "branch" };
        } else {
          sentences.push(`A ${branch} tem liberação registrada só para ${r.marca?.para ?? "outra pessoa"}; a dúvida fica para ${dono}.`);
          needsOwner = true;
        }
        break;
      case "reserved":
        sentences.push(`A ${branch} está reservada por ${dono}${r.marca?.motivo_como_dado ? `: ${r.marca.motivo_como_dado.replace(/\.$/, "")}` : ""}.`);
        needsOwner = true;
        break;
      case "in_progress":
        sentences.push(`A ${branch} está em andamento${r.pr ? `, com o PR ${r.pr.numero} ${PR_STATE[r.pr.estado] ?? r.pr.estado}` : ""}; não há liberação registrada.`);
        needsOwner = true;
        break;
      case "no_activity":
        sentences.push(`A ${branch} não tem atividade recente registrada nem liberação.`);
        needsOwner = true;
        break;
      default:
        sentences.push(`Não há registro sobre a ${branch}.`);
        needsOwner = true;
    }
  }

  const branchKeys = new Set(branches.map((b) => /^([a-z]+-\d+)/i.exec(b)?.[1]?.toUpperCase()));
  const keys = [...new Set([...question.matchAll(TASK_KEY)].map((m) => m[1]!.toUpperCase()))].filter((k) => !branchKeys.has(k) && !branches.some((b) => b.toUpperCase() === k));
  for (const key of keys) {
    const t = await ctx.data.task(key);
    if (!t) {
      sentences.push(`Não há registro da tarefa ${key}.`);
      needsOwner = true;
      continue;
    }
    const ref = `linear:${t.key}`;
    ctx.state.sources.set(ref, { label: `tarefa ${t.key}`, ref });
    fontes.push(ref);
    const resp = ctx.people.find((p) => p.id === t.assigneeId);
    sentences.push(`${t.key} está ${TASK_STATE[t.state] ?? t.state}${resp ? `, com ${firstName(resp)}` : ""}${t.dueDate ? `, prazo ${t.dueDate}` : ""}.`);
  }

  for (const m of question.matchAll(PR_NUMBER)) {
    const n = Number(m[1]);
    const prs = (await ctx.data.pullRequests({ number: n })).filter((pr) => canSeePr(ctx, pr));
    if (prs.length === 0) {
      sentences.push(`Não há PR ${n} visível para ${asker}.`);
      continue;
    }
    for (const pr of prs) {
      const ref = `github:pr/${pr.number}`;
      ctx.state.sources.set(ref, { label: `PR ${pr.number} (${pr.repository})`, ref });
      fontes.push(ref);
      const author = findPerson(ctx, pr.authorId);
      sentences.push(`O PR ${pr.number} (${pr.repository}) está ${PR_STATE[pr.state] ?? pr.state}${author ? `, de ${firstName(author)}` : ""}, na branch ${pr.branch}.`);
    }
  }

  if (sentences.length === 0) {
    const tail = ownerName ? ` A dúvida fica para ${ownerName}.` : "";
    return {
      status: "nao_sei",
      texto: `Sem o modelo, ${who.charAt(0).toLowerCase()}${who.slice(1)} só responde sobre branches, tarefas e PRs citados pelo nome.${tail}`,
      fontes: [],
      liberacao: null,
      precisa_do_dono: !!ownerName,
    };
  }
  return {
    status: fontes.length > 0 ? "respondido" : "nao_sei",
    texto: sentences.join(" "),
    fontes: [...new Set(fontes)],
    liberacao,
    precisa_do_dono: needsOwner || fontes.length === 0,
  };
}
