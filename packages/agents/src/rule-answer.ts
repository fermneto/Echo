// Resposta por regra, sem modelo (etapa 6): quando a API falha, o validador recusa, o modelo recusa
// ou o teto de custo é atingido. Só repete o que está registrado, com as mesmas ferramentas de leitura.
// Sai no idioma da conversa (português, inglês ou espanhol), com as frases abaixo.
import type { AnswerOutput } from "./index.ts";
import type { Lang } from "./language.ts";
import { canSeePr, findPerson, firstName, getBranchStatus, type ToolContext } from "./tools.ts";

const TASK_STATE: Record<Lang, Record<string, string>> = {
  pt: { backlog: "no backlog", todo: "a fazer", in_progress: "em andamento", in_review: "em revisão", done: "concluída", canceled: "cancelada" },
  en: { backlog: "in the backlog", todo: "to do", in_progress: "in progress", in_review: "in review", done: "done", canceled: "canceled" },
  es: { backlog: "en el backlog", todo: "por hacer", in_progress: "en curso", in_review: "en revisión", done: "terminada", canceled: "cancelada" },
};
const PR_STATE: Record<Lang, Record<string, string>> = {
  pt: { open: "aberto", draft: "em rascunho", merged: "incorporado", closed: "fechado" },
  en: { open: "open", draft: "a draft", merged: "merged", closed: "closed" },
  es: { open: "abierto", draft: "en borrador", merged: "incorporado", closed: "cerrado" },
};

/** Frases da resposta por regra. `who` é "O agente de Fernando" / "Fernando's agent" / "El agente de Fernando" / "O Echo". */
const T = {
  pt: {
    who: (o?: string) => (o ? `O agente de ${o}` : "O Echo"),
    evaluate: (w: string) => `${w} não avalia pessoas, não dá notas nem compara colegas.`,
    approveStrict: (w: string) => `${w} não aprova PRs, não faz merge e não publica em produção: essa decisão é sempre de uma pessoa, com aprovação registrada.`,
    approve: (w: string) => `${w} não aprova PRs nem publica em produção: essa decisão é sempre de uma pessoa.`,
    record: (w: string) => `${w} não grava vídeos por pedido no chat e nunca em produção: os vídeos das entregas são gravados só em ambientes de preview, com dados sintéticos, pelo relatório semanal, e a pessoa aprova antes do envio.`,
    reassign: (w: string) => `${w} não muda tarefas; a redistribuição passa por aprovação da liderança no painel.`,
    paused: "As perguntas livres ao Echo estão pausadas porque o limite de custo do mês foi atingido. Os agentes de quem está ausente seguem respondendo.",
    ambiguous: (b: string) => `A ${b} existe em mais de um repositório; vale dizer qual.`,
    someone: "a pessoa responsável",
    other: "outra pessoa",
    released: (b: string, a: string, d: string) => `A ${b} está liberada para ${a} na nota do dia confirmada de ${d}.`,
    releasedOther: (b: string, to: string, d: string) => `A ${b} tem liberação registrada só para ${to}; a dúvida fica para ${d}.`,
    reserved: (b: string, d: string, why: string) => `A ${b} está reservada por ${d}${why ? `: ${why}` : ""}.`,
    inProgress: (b: string, pr: string) => `A ${b} está em andamento${pr}; não há liberação registrada.`,
    withPr: (n: number, s: string) => `, com o PR ${n} ${s}`,
    noActivity: (b: string) => `A ${b} não tem atividade recente registrada nem liberação.`,
    noRecord: (b: string) => `Não há registro sobre a ${b}.`,
    noTask: (k: string) => `Não há registro da tarefa ${k}.`,
    taskLabel: (k: string) => `tarefa ${k}`,
    task: (k: string, s: string, who: string, due: string) => `${k} está ${s}${who ? `, com ${who}` : ""}${due ? `, prazo ${due}` : ""}.`,
    noPr: (n: number, a: string) => `Não há PR ${n} visível para ${a}.`,
    pr: (n: number, repo: string, s: string, author: string, branch: string) => `O PR ${n} (${repo}) está ${s}${author ? `, de ${author}` : ""}, na branch ${branch}.`,
    withoutModel: (w: string, o?: string) => `Sem o modelo, ${w.charAt(0).toLowerCase()}${w.slice(1)} só responde sobre branches, tarefas e PRs citados pelo nome.${o ? ` A dúvida fica para ${o}.` : ""}`,
  },
  en: {
    who: (o?: string) => (o ? `${o}'s agent` : "Echo"),
    evaluate: (w: string) => `${w} does not evaluate people, give ratings or compare colleagues.`,
    approveStrict: (w: string) => `${w} does not approve PRs, merge or deploy to production: that decision always belongs to a person, with a recorded approval.`,
    approve: (w: string) => `${w} does not approve PRs or deploy to production: that decision always belongs to a person.`,
    record: (w: string) => `${w} does not record videos on request in chat, and never in production: delivery videos are recorded only in preview environments, with synthetic data, by the weekly report, and the person approves them before they are sent.`,
    reassign: (w: string) => `${w} does not change tasks; redistribution goes through leadership approval in the panel.`,
    paused: "Free questions to Echo are paused because the monthly cost limit was reached. The agents of people who are away keep answering.",
    ambiguous: (b: string) => `${b} exists in more than one repository; please say which one.`,
    someone: "the person in charge",
    other: "someone else",
    released: (b: string, a: string, d: string) => `${b} is released to ${a} in ${d}'s confirmed daily note.`,
    releasedOther: (b: string, to: string, d: string) => `${b} has a release on record only for ${to}; the question goes to ${d}.`,
    reserved: (b: string, d: string, why: string) => `${b} is reserved by ${d}${why ? `: ${why}` : ""}.`,
    inProgress: (b: string, pr: string) => `${b} is in progress${pr}; there is no release on record.`,
    withPr: (n: number, s: string) => `, with PR ${n} ${s}`,
    noActivity: (b: string) => `${b} has no recent activity or release on record.`,
    noRecord: (b: string) => `There is no record about ${b}.`,
    noTask: (k: string) => `There is no record of task ${k}.`,
    taskLabel: (k: string) => `task ${k}`,
    task: (k: string, s: string, who: string, due: string) => `${k} is ${s}${who ? `, with ${who}` : ""}${due ? `, due ${due}` : ""}.`,
    noPr: (n: number, a: string) => `There is no PR ${n} visible to ${a}.`,
    pr: (n: number, repo: string, s: string, author: string, branch: string) => `PR ${n} (${repo}) is ${s}${author ? `, by ${author}` : ""}, on branch ${branch}.`,
    withoutModel: (w: string, o?: string) => `Without the model, ${w} only answers about branches, tasks and PRs mentioned by name.${o ? ` The question goes to ${o}.` : ""}`,
  },
  es: {
    who: (o?: string) => (o ? `El agente de ${o}` : "Echo"),
    evaluate: (w: string) => `${w} no evalúa personas, no pone notas ni compara colegas.`,
    approveStrict: (w: string) => `${w} no aprueba PRs, no hace merge ni publica en producción: esa decisión es siempre de una persona, con aprobación registrada.`,
    approve: (w: string) => `${w} no aprueba PRs ni publica en producción: esa decisión es siempre de una persona.`,
    record: (w: string) => `${w} no graba videos a pedido en el chat y nunca en producción: los videos de las entregas se graban solo en entornos de preview, con datos sintéticos, en el informe semanal, y la persona los aprueba antes del envío.`,
    reassign: (w: string) => `${w} no cambia tareas; la redistribución pasa por la aprobación del liderazgo en el panel.`,
    paused: "Las preguntas libres a Echo están pausadas porque se alcanzó el límite de costo del mes. Los agentes de quienes están ausentes siguen respondiendo.",
    ambiguous: (b: string) => `${b} existe en más de un repositorio; conviene decir cuál.`,
    someone: "la persona responsable",
    other: "otra persona",
    released: (b: string, a: string, d: string) => `${b} está liberada para ${a} en la nota del día confirmada de ${d}.`,
    releasedOther: (b: string, to: string, d: string) => `${b} tiene liberación registrada solo para ${to}; la duda queda para ${d}.`,
    reserved: (b: string, d: string, why: string) => `${b} está reservada por ${d}${why ? `: ${why}` : ""}.`,
    inProgress: (b: string, pr: string) => `${b} está en curso${pr}; no hay liberación registrada.`,
    withPr: (n: number, s: string) => `, con el PR ${n} ${s}`,
    noActivity: (b: string) => `${b} no tiene actividad reciente registrada ni liberación.`,
    noRecord: (b: string) => `No hay registro sobre ${b}.`,
    noTask: (k: string) => `No hay registro de la tarea ${k}.`,
    taskLabel: (k: string) => `tarea ${k}`,
    task: (k: string, s: string, who: string, due: string) => `${k} está ${s}${who ? `, con ${who}` : ""}${due ? `, plazo ${due}` : ""}.`,
    noPr: (n: number, a: string) => `No hay un PR ${n} visible para ${a}.`,
    pr: (n: number, repo: string, s: string, author: string, branch: string) => `El PR ${n} (${repo}) está ${s}${author ? `, de ${author}` : ""}, en la rama ${branch}.`,
    withoutModel: (w: string, o?: string) => `Sin el modelo, ${w.charAt(0).toLowerCase()}${w.slice(1)} solo responde sobre ramas, tareas y PRs citados por nombre.${o ? ` La duda queda para ${o}.` : ""}`,
  },
} satisfies Record<Lang, unknown>;

// Pedidos reconhecidos nos três idiomas: o que o agente nunca faz não depende do idioma da pergunta.
const EVALUATION =
  /(?<!\p{L})((bom|boa|[óo]tim[oa]|ruim|melhor|pior)\s+(funcion[áa]ri|profissional|colega)|promo[çc]|demiss|demitir|sal[áa]ri|aumento|ranking|desempenho|avali[ae]|(good|great|bad|best|worst|better|worse)\s+(employee|professional|colleague|developer|engineer)|promot|fire\s+(him|her|them)|layoff|salary|pay\s+raise|performance|(buen|buena|mal|mala|mejor|peor)\s+(emplead|profesional|colega)|ascen|despid|despedir|sueldo|desempe[ñn]o)/iu;
const APPROVAL = /(?<!\p{L})(aprov|aprob|merge|publi(?:car|que|ca|sh)(?!\p{L})|produ[çc][ãa]o|producci[óo]n|production|deploy|approv)/iu;
const REASSIGN = /(?<!\p{L})(atribu|reatribu|transfer|redistribu|assum(?:ir|a) (?:as|todas)|reassign|assign|hand\s+over|take\s+over\s+all|asign|reasign)/iu;
/** Pedido de gravação pelo chat: os vídeos das entregas saem só do fluxo do relatório, em preview. */
const RECORDING = /(?<!\p{L})(grav(?:e|ar|em)|film(?:e|ar|em)|fa[çc]a (?:um|o) v[íi]deo|record\s+(?:a\s+)?(?:video|screen)|make\s+a\s+video|grab(?:a|ar|en)|haz\s+un\s+video)(?!\p{L})/iu;

const BRANCH = /(?<![\w-])([a-z][a-z0-9]*-\d+-[a-z0-9][a-z0-9-]*)(?![\w-])/gi;
const TASK_KEY = /(?<![\w-])([A-Za-z][A-Za-z0-9]*-\d+)(?![\w-])/g;
const PR_NUMBER = /(?<!\p{L})PR\s*(?:#|n[ºo°]?\s*)?(\d+)/giu;

// Pedidos que nunca chegam ao modelo (regra 7): aprovar, fazer merge, publicar em produção, avaliar pessoas.
// Mais estritos que os de cima: "o PR 44 foi aprovado?" é pergunta de fato e segue para o fluxo normal.
const APPROVE_REQUEST =
  /(?<!\p{L})(aprovar|aprove|aprova\s+(?:meu|o|esse|este|a|minha)|fazer\s+o\s+merge|faz\s+o\s+merge|fa[çc]a\s+o\s+merge|mergear|mergeia|publicar\s+em\s+produ[çc][ãa]o|publique\s+em\s+produ[çc][ãa]o|deploy\s+em\s+produ[çc][ãa]o|approve\s+(?:my|the|this|that|it|pr)|please\s+approve|merge\s+(?:my|the|this|that|it|pr)|deploy\s+(?:it\s+|this\s+)?to\s+production|push\s+to\s+production|aprobar|aprueba\s+(?:mi|el|este|ese|la)|haz\s+el\s+merge|hacer\s+el\s+merge|publicar\s+en\s+producci[óo]n|publica\s+en\s+producci[óo]n|deploy\s+en\s+producci[óo]n)(?!\p{L})/iu;
// "Quem precisa aprovar o PR 44?" é pergunta de fato.
const WHO_APPROVES = /(?<!\p{L})(quem\s+(?:pode|precisa|deve|vai|consegue|costuma)\s+aprovar|who\s+(?:can|needs\s+to|should|will|has\s+to|usually)\s+approve|qui[ée]n\s+(?:puede|necesita|debe|va\s+a|suele)\s+aprobar)/iu;
const EVALUATE_REQUEST =
  /(?<!\p{L})((?:bom|boa|[óo]tim[oa]|ruim|melhor|pior)\s+(?:funcion[áa]ri[oa]|profissional|colega)|merece\s+(?:uma\s+|um\s+)?(?:promo[çc][ãa]o|aumento|demiss[ãa]o|b[ôo]nus)|promo[çc][ãa]o|promover|demitir|demiss[ãa]o|sal[áa]rio|ranking|quem\s+(?:trabalha|entrega|produz)\s+(?:mais|menos)|(?:good|great|bad|best|worst|better|worse)\s+(?:employee|professional|colleague|developer|engineer)|deserves?\s+(?:a\s+)?(?:promotion|raise|bonus)|promotion|promote|fire\s+(?:him|her|them)|salary|who\s+(?:works|delivers|produces)\s+(?:more|less|the\s+most|the\s+least)|(?:buen|buena|mal|mala|mejor|peor)\s+(?:emplead[oa]|profesional|colega)|merece\s+(?:un\s+|una\s+)?(?:ascenso|aumento|despido|bono)|ascenso|ascender|despedir|despido|salario|sueldo|qui[ée]n\s+(?:trabaja|entrega|produce)\s+(?:m[áa]s|menos))(?!\p{L})/iu;

const refuse = (texto: string): AnswerOutput => ({ status: "recusado", texto, fontes: [], liberacao: null, precisa_do_dono: false });

/** Recusa fixa, em código, para o que o agente nunca faz. Devolve null quando o pedido é legítimo. */
export function forbiddenRequest(question: string, ownerName: string | undefined, lang: Lang = "pt"): AnswerOutput | null {
  const t = T[lang];
  const who = t.who(ownerName);
  if (EVALUATE_REQUEST.test(question)) return refuse(t.evaluate(who));
  if (APPROVE_REQUEST.test(question) && !WHO_APPROVES.test(question)) return refuse(t.approveStrict(who));
  return null;
}

/** Resposta do teto de custo para a pergunta livre ao Echo (pausada a 100% do limite). */
export function echoPaused(lang: Lang = "pt"): AnswerOutput {
  return refuse(T[lang].paused);
}
export const ECHO_PAUSED: AnswerOutput = echoPaused("pt");

export async function ruleAnswer(ctx: ToolContext, question: string, lang: Lang = "pt"): Promise<AnswerOutput> {
  const t = T[lang];
  const ownerName = ctx.owner ? firstName(ctx.owner) : undefined;
  const asker = firstName(ctx.asker);
  const who = t.who(ownerName);

  if (EVALUATION.test(question)) return refuse(t.evaluate(who));
  if (RECORDING.test(question)) return refuse(t.record(who));
  if (APPROVAL.test(question)) return refuse(t.approve(who));
  if (REASSIGN.test(question)) return refuse(t.reassign(who));

  const sentences: string[] = [];
  const fontes: string[] = [];
  let liberacao: AnswerOutput["liberacao"] = null;
  let needsOwner = false;

  const branches = [...new Set([...question.matchAll(BRANCH)].map((m) => m[1]!.toLowerCase()))];
  for (const branch of branches) {
    const r = await getBranchStatus(ctx, branch);
    if (!("estado" in r)) {
      sentences.push(t.ambiguous(branch));
      continue;
    }
    fontes.push(...r.fontes);
    const dono = r.dono ?? ownerName ?? t.someone;
    switch (r.estado) {
      case "released":
        if (r.liberada_para_quem_pergunta) {
          sentences.push(t.released(branch, asker, dono));
          liberacao ??= { alvo: branch, tipo: "branch" };
        } else {
          sentences.push(t.releasedOther(branch, r.marca?.para ?? t.other, dono));
          needsOwner = true;
        }
        break;
      case "reserved":
        sentences.push(t.reserved(branch, dono, r.marca?.motivo_como_dado ? r.marca.motivo_como_dado.replace(/\.$/, "") : ""));
        needsOwner = true;
        break;
      case "in_progress":
        sentences.push(t.inProgress(branch, r.pr ? t.withPr(r.pr.numero, PR_STATE[lang][r.pr.estado] ?? r.pr.estado) : ""));
        needsOwner = true;
        break;
      case "no_activity":
        sentences.push(t.noActivity(branch));
        needsOwner = true;
        break;
      default:
        sentences.push(t.noRecord(branch));
        needsOwner = true;
    }
  }

  const branchKeys = new Set(branches.map((b) => /^([a-z]+-\d+)/i.exec(b)?.[1]?.toUpperCase()));
  const keys = [...new Set([...question.matchAll(TASK_KEY)].map((m) => m[1]!.toUpperCase()))].filter((k) => !branchKeys.has(k) && !branches.some((b) => b.toUpperCase() === k));
  for (const key of keys) {
    const task = await ctx.data.task(key);
    if (!task) {
      sentences.push(t.noTask(key));
      needsOwner = true;
      continue;
    }
    const ref = `linear:${task.key}`;
    ctx.state.sources.set(ref, { label: t.taskLabel(task.key), ref });
    fontes.push(ref);
    const resp = ctx.people.find((p) => p.id === task.assigneeId);
    sentences.push(t.task(task.key, TASK_STATE[lang][task.state] ?? task.state, resp ? firstName(resp) : "", task.dueDate ?? ""));
  }

  for (const m of question.matchAll(PR_NUMBER)) {
    const n = Number(m[1]);
    const prs = (await ctx.data.pullRequests({ number: n })).filter((pr) => canSeePr(ctx, pr));
    if (prs.length === 0) {
      sentences.push(t.noPr(n, asker));
      continue;
    }
    for (const pr of prs) {
      const ref = `github:pr/${pr.number}`;
      ctx.state.sources.set(ref, { label: `PR ${pr.number} (${pr.repository})`, ref });
      fontes.push(ref);
      const author = findPerson(ctx, pr.authorId);
      sentences.push(t.pr(pr.number, pr.repository, PR_STATE[lang][pr.state] ?? pr.state, author ? firstName(author) : "", pr.branch));
    }
  }

  if (sentences.length === 0) {
    return { status: "nao_sei", texto: t.withoutModel(who, ownerName), fontes: [], liberacao: null, precisa_do_dono: !!ownerName };
  }
  return {
    status: fontes.length > 0 ? "respondido" : "nao_sei",
    texto: sentences.join(" "),
    fontes: [...new Set(fontes)],
    liberacao,
    precisa_do_dono: needsOwner || fontes.length === 0,
  };
}
