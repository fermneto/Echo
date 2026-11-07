// Evidência para o quem sabe (etapa 7, Calculadora do quem sabe). Só entra o que quem pergunta pode ver:
// PRs incorporados de repositórios visíveis, revisões nesses PRs, tarefas concluídas, ajudas confirmadas
// ligadas a uma entrega do tema, perfil (habilidades e áreas) e os ajustes da própria pessoa.
// A pontuação e a ordem saem de `peopleForTopic`; aqui só se junta a evidência.
import { capacityCard, peopleForTopic, type Person, type PullRequest, type SourceRef, type Task, type TopicCandidate, type TopicEvidence } from "@echo/domain";
import { canSeePr, firstName, type ToolContext } from "./tools.ts";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const STOP = new Set(
  "a o os as um uma uns umas de do da dos das no na nos nas em para por com sem sobre que como e ou mas se quem alguem algum alguma sabe entende conhece manja mexer time equipe aqui pessoal agora hoje amanha preciso precisa falar ajuda ajudar alguém servico servicos parte coisa coisas the of and".split(" "),
);

/** Palavras úteis de um termo ("serviço de pagamentos" → ["pagamentos"]). */
export function termWords(terms: string[]): string[] {
  const words = new Set<string>();
  for (const t of terms) {
    const f = fold(t);
    if (f.length >= 3 && !f.includes(" ")) words.add(f);
    for (const w of f.split(/[^a-z0-9#+.-]+/)) if (w.length >= 3 && !STOP.has(w)) words.add(w);
  }
  return [...words];
}

/** Casa o texto com algum termo, tolerando plural simples ("pagamento" ~ "pagamentos"). */
export function matcher(terms: string[]): (s: string | undefined | null) => boolean {
  const words = termWords(terms).map((w) => w.replace(/s$/, ""));
  return (s) => {
    if (!s) return false;
    const f = fold(s);
    return words.some((w) => w.length >= 3 && f.includes(w));
  };
}

const prSource = (pr: PullRequest): SourceRef => ({ label: `PR ${pr.number} (${pr.repository})`, ref: `github:pr/${pr.number}` });
const taskSource = (t: Task): SourceRef => ({ label: `tarefa ${t.key}`, ref: `linear:${t.key}` });

export interface TopicResult {
  candidates: (TopicCandidate & { person: Person; vacationUntil?: Date })[];
  /** Fontes de cada pessoa indicada, já registradas na execução. */
  sources: SourceRef[];
}

export async function topicCandidates(ctx: ToolContext, terms: string[]): Promise<TopicResult> {
  const has = matcher(terms);
  const evidence: TopicEvidence[] = [];
  const now = ctx.now;
  const [prs, tasks, overrides, contributions] = await Promise.all([
    ctx.data.pullRequests({}),
    ctx.data.tasks({}),
    ctx.data.expertiseOverrides(),
    ctx.data.contributions(new Date(now.getTime() - 365 * 86_400_000)),
  ]);
  const visiblePrs = prs.filter((pr) => canSeePr(ctx, pr));
  const prMatches = (pr: PullRequest) => has(pr.title) || has(pr.branch) || pr.files.some(has) || (pr.taskKey ? has(tasks.find((t) => t.key === pr.taskKey)?.title) : false);
  const taskMatches = (t: Task) => has(t.title) || has(t.area) || t.labels.some(has);

  for (const p of ctx.people) {
    if ([...p.skills, ...p.areas].some(has)) evidence.push({ personId: p.id, kind: "profile", at: now, source: { label: `perfil de ${firstName(p)}`, ref: `perfil:${p.id}` } });
  }
  for (const pr of visiblePrs) {
    if (!prMatches(pr)) continue;
    if (pr.state === "merged" && pr.authorId) evidence.push({ personId: pr.authorId, kind: "pr_merged", at: pr.mergedAt ?? pr.openedAt ?? now, source: prSource(pr) });
    for (const r of pr.reviewerIds) if (r !== pr.authorId) evidence.push({ personId: r, kind: "review", at: pr.mergedAt ?? pr.openedAt ?? now, source: prSource(pr) });
  }
  for (const t of tasks) {
    if (t.state === "done" && t.assigneeId && taskMatches(t)) evidence.push({ personId: t.assigneeId, kind: "task_done", at: now, source: taskSource(t) });
  }
  for (const c of contributions) {
    if (!c.confirmed || !c.deliveryRef) continue;
    const pr = /^github:pr\/(\d+)$/.exec(c.deliveryRef);
    const task = /^linear:(.+)$/.exec(c.deliveryRef);
    const delivery = pr ? visiblePrs.find((p) => p.number === Number(pr[1])) : undefined;
    const deliveryTask = task ? tasks.find((t) => t.key === task[1]) : undefined;
    if (delivery && prMatches(delivery)) evidence.push({ personId: c.helperId, kind: "help", at: c.occurredAt, source: prSource(delivery) });
    else if (deliveryTask && taskMatches(deliveryTask)) evidence.push({ personId: c.helperId, kind: "help", at: c.occurredAt, source: taskSource(deliveryTask) });
  }

  // Ajustes da pessoa (expertise_overrides): incluir conta como perfil; excluir tira a pessoa desta pergunta.
  const excluded = new Set(ctx.people.filter((p) => p.role === "hr").map((p) => p.id));
  excluded.add(ctx.asker.id);
  for (const o of overrides) {
    if (o.validUntil && o.validUntil.getTime() <= now.getTime()) continue;
    if (!has(o.topic) && !termWords([o.topic]).some((w) => termWords(terms).includes(w))) continue;
    if (o.include) evidence.push({ personId: o.personId, kind: "profile", at: now, source: { label: `ajuste de ${firstName(ctx.people.find((p) => p.id === o.personId) ?? { name: "?" })}`, ref: `ajuste:${o.personId}` } });
    else excluded.add(o.personId);
  }

  // Situação: férias pela ausência ativa; acima do limite pelo cartão de capacidade.
  const open = tasks.filter((t) => ["backlog", "todo", "in_progress", "in_review"].includes(t.state));
  const openPrs = prs.filter((pr) => pr.state === "open" || pr.state === "draft");
  const vacationEnd = new Map<string, Date>();
  for (const a of ctx.absences) {
    if ((a.kind === "vacation" || a.kind === "leave") && a.startsAt <= now && now < a.endsAt) vacationEnd.set(a.personId, a.endsAt);
  }
  const status: Record<string, TopicCandidate["status"]> = {};
  for (const p of ctx.people) {
    if (vacationEnd.has(p.id)) status[p.id] = "vacation";
    else {
      const card = capacityCard({
        person: p,
        openTasks: open.filter((t) => t.assigneeId === p.id),
        pendingReviews: openPrs.filter((pr) => pr.reviewerIds.includes(p.id)).length,
        absences: ctx.absences,
        adjustment: 0,
        teamLimit: (p.teamId && ctx.settings.teamLoadLimits[p.teamId]) || 12,
        now,
      });
      status[p.id] = card.overLimit ? "over_limit" : "available";
    }
  }

  const found = peopleForTopic({ evidence, people: ctx.people, status, excluded: [...excluded], now });
  const sources: SourceRef[] = [];
  const candidates = found.map((c) => {
    for (const s of c.evidence) {
      if (!ctx.state.sources.has(s.ref)) ctx.state.sources.set(s.ref, s);
      if (!sources.some((x) => x.ref === s.ref)) sources.push(s);
    }
    const person = ctx.people.find((p) => p.id === c.personId)!;
    const until = vacationEnd.get(c.personId);
    return { ...c, person, ...(until ? { vacationUntil: until } : {}) };
  });
  return { candidates, sources };
}
