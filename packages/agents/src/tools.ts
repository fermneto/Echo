// Ferramentas do agente (etapa 6). Todas SOMENTE LEITURA: aprovar, mudar tarefa ou escrever em qualquer
// plataforma é impossível por aqui, não só proibido. A permissão é checada dentro de cada ferramenta,
// antes de o dado chegar ao modelo. Cada fonte consultada fica registrada para o validador.
import type Anthropic from "@anthropic-ai/sdk";
import { ciStatus, deployStatus, type CodeHost, type IssueTracker, type LiveChecks } from "@echo/connectors";
import { absences, dailyNotes, people, pullRequests, tasks, withOrg, workEvents, type Database } from "@echo/db";
import { branchStatus, isAway, type DailyNote, type Person, type PullRequest, type SourceRef, type Task } from "@echo/domain";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";

export interface ToolContext {
  db: Database;
  orgId: string;
  asker: { id: string; role: "member" | "leader" | "hr" };
  owner?: { id: string; name: string } | undefined;
  now: Date;
  /** Repositório padrão da empresa, quando há um só. */
  defaultRepo?: string | undefined;
  live?: { code?: (CodeHost & Partial<LiveChecks>) | undefined; issues?: IssueTracker | undefined };
  /** Fontes consultadas nesta execução (ref → rótulo). */
  sources: Map<string, string>;
  /** Alvos com liberação registrada e válida, vistos nesta execução. */
  released: Set<string>;
  /** A resposta usou uma nota que não foi confirmada. */
  usedUnconfirmedNote: boolean;
  toolsUsed: string[];
}

const src = (ctx: ToolContext, s: SourceRef) => (ctx.sources.set(s.ref, s.label), s.ref);
const denied = { erro: "sem permissão: o RH vê só a disponibilidade da equipe" };

type PersonRow = typeof people.$inferSelect;
const toPerson = (p: PersonRow): Person => ({
  id: p.id,
  orgId: p.orgId,
  name: p.name,
  role: p.role === "leader" || p.role === "hr" ? p.role : "member",
  teamId: p.teamId ?? undefined,
  timezone: p.timezone,
  workHours: p.workHours,
  skills: p.skills,
  areas: p.areas,
  active: p.active,
});
const toTask = (t: typeof tasks.$inferSelect): Task => ({
  id: t.id,
  key: t.key,
  title: t.title,
  assigneeId: t.assigneeId ?? undefined,
  state: t.state as Task["state"],
  dueDate: t.dueDate ?? undefined,
  size: t.size ?? undefined,
  area: t.area ?? undefined,
  labels: t.labels,
  hasLinearId: Boolean(t.linearId),
});
const toPr = (p: typeof pullRequests.$inferSelect): PullRequest => ({
  id: p.id,
  repository: p.repository,
  number: p.number,
  title: p.title,
  authorId: p.authorId ?? undefined,
  state: p.state as PullRequest["state"],
  branch: p.branch,
  files: p.files,
  taskKey: p.taskKey ?? undefined,
  reviewerIds: p.reviewerIds,
  openedAt: p.openedAt ?? undefined,
  mergedAt: p.mergedAt ?? undefined,
});

const taskKeyOf = (s: string) => s.match(/\b([a-z][a-z0-9]{1,9})-(\d+)\b/i)?.slice(1).join("-").toUpperCase();
const TASK_STATE: Record<string, string> = { backlog: "no backlog", todo: "a fazer", in_progress: "em andamento", in_review: "em revisão", done: "concluída", canceled: "cancelada" };

/** Nomes das pessoas da empresa (para as ferramentas devolverem nomes, não ids). */
async function names(ctx: ToolContext): Promise<Map<string, string>> {
  const rows = await withOrg(ctx.db, ctx.orgId, (tx) => tx.select({ id: people.id, name: people.name }).from(people).where(eq(people.orgId, ctx.orgId)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function latestNote(ctx: ToolContext, personId: string): Promise<DailyNote | null> {
  const [n] = await withOrg(ctx.db, ctx.orgId, (tx) =>
    tx
      .select()
      .from(dailyNotes)
      .where(and(eq(dailyNotes.orgId, ctx.orgId), eq(dailyNotes.personId, personId), inArray(dailyNotes.state, ["confirmed", "auto_unreviewed"])))
      .orderBy(desc(dailyNotes.date))
      .limit(1),
  );
  if (!n) return null;
  return {
    personId: n.personId,
    date: n.date,
    stoppedAt: n.stoppedAt ?? undefined,
    blocked: n.blocked ?? undefined,
    released: n.released,
    reserved: n.reserved,
    state: n.state as DailyNote["state"],
    confirmedAt: n.confirmedAt ?? undefined,
  };
}

// ---------------------------------------------------------------- definições (estáveis: entram no cache)

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, properties, required, additionalProperties: false });

export const TOOL_DEFS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "get_daily_note",
    description: "Última nota do dia publicada do dono do agente: onde parou, o que travou, o que deixou liberado e reservado, e se foi confirmada.",
    input_schema: obj({}, []),
  },
  {
    name: "get_branch_status",
    description: "Estado de uma branch pelas regras do Echo (liberada, reservada, em andamento, sem atividade ou desconhecida), com a nota do dia, o PR e a tarefa. Use sempre que perguntarem se dá para seguir, mexer ou usar uma branch.",
    input_schema: obj({ branch: { type: "string", description: "Nome exato da branch, ex.: ech-131-api-v2" } }, ["branch"]),
  },
  {
    name: "get_task",
    description: "Tarefa do Linear consultada ao vivo quando possível: estado, responsável e prazo. Use para 'já terminou?'.",
    input_schema: obj({ key: { type: "string", description: "Identificador, ex.: ECH-128" } }, ["key"]),
  },
  {
    name: "get_pr",
    description: "PR do GitHub: estado, branch, autor, revisores, tarefa ligada e estado dos checks.",
    input_schema: obj({ number: { type: "integer" }, repository: { type: ["string", "null"], description: "org/repo; nulo usa o repositório da empresa" } }, ["number", "repository"]),
  },
  {
    name: "get_ci_status",
    description: "Os testes (checks) do último commit de um PR passaram? Ao vivo no GitHub quando possível.",
    input_schema: obj({ number: { type: "integer" }, repository: { type: ["string", "null"] } }, ["number", "repository"]),
  },
  {
    name: "get_deploy_status",
    description: "Preview e produção de um PR: se já foi para produção (PR unido e deploy de produção pronto depois do merge).",
    input_schema: obj({ number: { type: "integer" }, repository: { type: ["string", "null"] } }, ["number", "repository"]),
  },
  {
    name: "list_team",
    description: "Pessoas da equipe, quem está no expediente agora e quando volta quem não está, pelos expedientes e ausências cadastrados.",
    input_schema: obj({}, []),
  },
  {
    name: "list_tasks",
    description: "Tarefas abertas, opcionalmente de uma pessoa (pelo nome) ou sem responsável.",
    input_schema: obj({ assignee: { type: ["string", "null"], description: "Nome da pessoa, 'sem responsável' ou nulo para todas" } }, ["assignee"]),
  },
  {
    name: "list_pull_requests",
    description: "PRs abertos, opcionalmente de um autor ou esperando revisão de alguém (pelo nome).",
    input_schema: obj({ author: { type: ["string", "null"] }, reviewer: { type: ["string", "null"] } }, ["author", "reviewer"]),
  },
  {
    name: "list_recent_events",
    description: "O que uma pessoa fez nos últimos dias (commits, PRs, revisões, tarefas concluídas), só referências, sem conteúdo.",
    input_schema: obj({ person: { type: "string", description: "Nome da pessoa" }, days: { type: "integer", description: "1 a 7" } }, ["person", "days"]),
  },
].map((t, i, all) => ({ ...t, strict: true, ...(i === all.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}) }));

// ---------------------------------------------------------------- execução

export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<unknown> {
  ctx.toolsUsed.push(name);
  const hr = ctx.asker.role === "hr";
  if (hr && name !== "list_team") return denied;
  const repoOf = (r: unknown) => (typeof r === "string" && r ? r : ctx.defaultRepo);

  switch (name) {
    case "get_daily_note": {
      if (!ctx.owner) return { erro: "sem dono: este é o agente da equipe" };
      const note = await latestNote(ctx, ctx.owner.id);
      if (!note) return { encontrada: false, aviso: "sem nota do dia publicada; use GitHub e Linear" };
      if (note.state !== "confirmed") ctx.usedUnconfirmedNote = true;
      const ref = src(ctx, { label: `nota do dia de ${ctx.owner.name} (${note.state === "confirmed" ? "confirmada" : "publicada sem conferência"})`, ref: `daily_note:${note.personId}:${note.date}` });
      return {
        fonte: ref,
        data: note.date,
        confirmada: note.state === "confirmed",
        parou_em: note.stoppedAt ?? null,
        travou: note.blocked ?? null,
        // Nota sem conferência não libera nada.
        liberado: note.state === "confirmed" ? note.released.map((m) => ({ branch: m.branch, motivo: m.reason ?? null })) : [],
        reservado: note.reserved.map((m) => ({ branch: m.branch, motivo: m.reason ?? null })),
      };
    }

    case "get_branch_status": {
      const branch = String(input.branch ?? "");
      const note = ctx.owner ? await latestNote(ctx, ctx.owner.id) : null;
      const { pr, task, lastCommitAt } = await withOrg(ctx.db, ctx.orgId, async (tx) => {
        const [p] = await tx.select().from(pullRequests).where(and(eq(pullRequests.orgId, ctx.orgId), eq(pullRequests.branch, branch))).orderBy(desc(pullRequests.updatedAt)).limit(1);
        const key = taskKeyOf(branch);
        const [t] = key ? await tx.select().from(tasks).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.key, key))) : [];
        const [c] = await tx
          .select({ at: workEvents.occurredAt })
          .from(workEvents)
          .where(and(eq(workEvents.orgId, ctx.orgId), eq(workEvents.type, "commit"), eq(workEvents.branch, branch)))
          .orderBy(desc(workEvents.occurredAt))
          .limit(1);
        return { pr: p, task: t, lastCommitAt: c?.at };
      });
      const r = branchStatus({ branch, ...(note ? { note } : {}), ...(pr ? { pr: toPr(pr) } : {}), ...(task ? { task: toTask(task) } : {}), ...(lastCommitAt ? { lastCommitAt } : {}), now: ctx.now });
      if (note && note.state !== "confirmed" && r.sources.some((s) => s.ref.startsWith("daily_note:"))) ctx.usedUnconfirmedNote = true;
      const fontes = r.sources.map((s) =>
        s.ref.startsWith("daily_note:") && ctx.owner ? src(ctx, { label: `nota do dia de ${ctx.owner.name} (${note?.state === "confirmed" ? "confirmada" : "publicada sem conferência"})`, ref: s.ref }) : src(ctx, s),
      );
      if (r.status === "released") ctx.released.add(branch.toLowerCase());
      return { branch, estado: r.status, motivo: r.mark?.reason ?? null, fontes, nota_confirmada: note ? note.state === "confirmed" : null };
    }

    case "get_task": {
      const key = String(input.key ?? "").toUpperCase();
      const who = await names(ctx);
      const [mirror] = await withOrg(ctx.db, ctx.orgId, (tx) => tx.select().from(tasks).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.key, key))));
      let live = false;
      let state = mirror?.state;
      let due = mirror?.dueDate ?? null;
      if (ctx.live?.issues) {
        try {
          const t = await ctx.live.issues.getTask(key);
          if (t) ((state = t.state), (due = t.dueDate ?? null), (live = true));
        } catch {
          // Linear fora: vale o último registro, avisando.
        }
      }
      if (!state) return { encontrada: false };
      const ref = src(ctx, { label: `${key} no Linear${live ? " (ao vivo)" : ""}`, ref: `linear:${key}` });
      return { fonte: ref, tarefa: key, titulo: mirror?.title ?? null, estado: TASK_STATE[state] ?? state, responsavel: mirror?.assigneeId ? (who.get(mirror.assigneeId) ?? null) : null, prazo: due, ao_vivo: live, registrado_em: live ? null : (mirror?.externalUpdatedAt?.toISOString() ?? null) };
    }

    case "get_pr": {
      const repo = repoOf(input.repository);
      const number = Number(input.number);
      const who = await names(ctx);
      const [p] = await withOrg(ctx.db, ctx.orgId, (tx) =>
        tx.select().from(pullRequests).where(and(eq(pullRequests.orgId, ctx.orgId), eq(pullRequests.number, number), ...(repo ? [eq(pullRequests.repository, repo)] : []))),
      );
      if (!p) return { encontrado: false };
      let state = p.state;
      let live = false;
      if (ctx.live?.code) {
        try {
          const l = await ctx.live.code.getPullRequest(p.repository, number);
          if (l) ((state = l.state), (live = true));
        } catch {
          // GitHub fora: vale o espelho.
        }
      }
      const ref = src(ctx, { label: `PR ${number}`, ref: `github:pr/${number}` });
      return { fonte: ref, numero: number, repositorio: p.repository, titulo: p.title, estado: state, branch: p.branch, autor: p.authorId ? (who.get(p.authorId) ?? null) : null, revisores: p.reviewerIds.map((id) => who.get(id) ?? "?"), tarefa: p.taskKey, checks: p.checksState, ao_vivo: live };
    }

    case "get_ci_status": {
      const repo = repoOf(input.repository);
      if (!repo) return { erro: "informe o repositório" };
      const s = await ciStatus(ctx.db, ctx.orgId, repo, Number(input.number), ctx.live?.code?.getChecks ? (ctx.live.code as LiveChecks) : undefined);
      if (!s) return { encontrado: false };
      const ref = src(ctx, { label: `checks do PR ${s.number}${s.live ? " (ao vivo)" : ""}`, ref: `github:checks/${s.number}` });
      return { fonte: ref, estado: s.state, falharam: s.failed, ao_vivo: s.live, link: s.url };
    }

    case "get_deploy_status": {
      const repo = repoOf(input.repository);
      if (!repo) return { erro: "informe o repositório" };
      const d = await deployStatus(ctx.db, ctx.orgId, repo, Number(input.number));
      if (!d) return { encontrado: false };
      const ref = src(ctx, { label: `deploys do PR ${d.number}`, ref: `deploy:pr/${d.number}` });
      return { fonte: ref, unido: d.merged, em_producao: d.inProduction, preview: d.preview?.state ?? null, link_preview: d.preview?.url ?? null, producao: d.production?.state ?? null };
    }

    case "list_team": {
      const { rows, abs } = await withOrg(ctx.db, ctx.orgId, async (tx) => ({
        rows: await tx.select().from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.active, true))),
        abs: await tx.select().from(absences).where(and(eq(absences.orgId, ctx.orgId), isNull(absences.cancelledAt), gte(absences.endsAt, ctx.now))),
      }));
      const list = abs.map((a) => ({ personId: a.personId, startsAt: a.startsAt, endsAt: a.endsAt, kind: a.kind as "vacation" }));
      const ref = src(ctx, { label: "expedientes e ausências cadastrados", ref: "team:schedule" });
      return {
        fonte: ref,
        // O motivo da ausência nunca aparece: só se a pessoa está e quando volta.
        pessoas: rows.map((p) => {
          const a = isAway(toPerson(p), list, ctx.now);
          return { nome: p.name, disponivel: !a.away, situacao: a.away ? (a.reason === "absence" ? "ausente" : "fora do expediente") : "no expediente", volta: a.returnsAt?.toISOString() ?? null, fuso: p.timezone };
        }),
      };
    }

    case "list_tasks": {
      const who = await names(ctx);
      const byName = new Map([...who].map(([id, n]) => [n.toLowerCase(), id]));
      const filter = typeof input.assignee === "string" ? input.assignee.toLowerCase() : null;
      const rows = await withOrg(ctx.db, ctx.orgId, (tx) =>
        tx.select().from(tasks).where(and(eq(tasks.orgId, ctx.orgId), inArray(tasks.state, ["backlog", "todo", "in_progress", "in_review"]))).orderBy(tasks.key).limit(50),
      );
      const picked = rows.filter((t) => !filter || (filter.startsWith("sem") ? !t.assigneeId : t.assigneeId === byName.get(filter)));
      return { tarefas: picked.map((t) => ({ fonte: src(ctx, { label: `${t.key} no Linear`, ref: `linear:${t.key}` }), tarefa: t.key, titulo: t.title, estado: TASK_STATE[t.state] ?? t.state, responsavel: t.assigneeId ? (who.get(t.assigneeId) ?? null) : null, prazo: t.dueDate })) };
    }

    case "list_pull_requests": {
      const who = await names(ctx);
      const byName = new Map([...who].map(([id, n]) => [n.toLowerCase(), id]));
      const author = typeof input.author === "string" ? byName.get(input.author.toLowerCase()) : undefined;
      const reviewer = typeof input.reviewer === "string" ? byName.get(input.reviewer.toLowerCase()) : undefined;
      const rows = await withOrg(ctx.db, ctx.orgId, (tx) =>
        tx.select().from(pullRequests).where(and(eq(pullRequests.orgId, ctx.orgId), or(eq(pullRequests.state, "open"), eq(pullRequests.state, "draft")))).limit(50),
      );
      const picked = rows.filter((p) => (!author || p.authorId === author) && (!reviewer || p.reviewerIds.includes(reviewer)));
      return { prs: picked.map((p) => ({ fonte: src(ctx, { label: `PR ${p.number}`, ref: `github:pr/${p.number}` }), numero: p.number, titulo: p.title, autor: p.authorId ? (who.get(p.authorId) ?? null) : null, aberto_em: p.openedAt?.toISOString() ?? null, revisores: p.reviewerIds.map((id) => who.get(id) ?? "?") })) };
    }

    case "list_recent_events": {
      const who = await names(ctx);
      const personId = [...who].find(([, n]) => n.toLowerCase() === String(input.person ?? "").toLowerCase())?.[0];
      if (!personId) return { erro: "pessoa não encontrada" };
      const days = Math.min(Math.max(Number(input.days) || 1, 1), 7);
      const rows = await withOrg(ctx.db, ctx.orgId, (tx) =>
        tx
          .select({ type: workEvents.type, taskKey: workEvents.taskKey, prNumber: workEvents.prNumber, branch: workEvents.branch, at: workEvents.occurredAt, ref: workEvents.sourceRef })
          .from(workEvents)
          .where(and(eq(workEvents.orgId, ctx.orgId), eq(workEvents.personId, personId), gte(workEvents.occurredAt, new Date(ctx.now.getTime() - days * 86_400_000))))
          .orderBy(desc(workEvents.occurredAt))
          .limit(30),
      );
      const ref = src(ctx, { label: `registro do trabalho de ${who.get(personId)}`, ref: `work_events:${personId}:${days}d` });
      return { fonte: ref, eventos: rows.map((e) => ({ tipo: e.type, tarefa: e.taskKey, pr: e.prNumber, branch: e.branch, quando: e.at.toISOString() })) };
    }

    default:
      return { erro: `ferramenta desconhecida: ${name}` };
  }
}
