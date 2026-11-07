// Empresa de demonstração (etapa 2). Só dados sintéticos: Fernando, Eduardo e Yan têm o nome real,
// com trabalho inventado; as demais personas são simuladas.
// Datas são relativas ao `now` recebido, para a história valer em qualquer dia da apresentação.
import type { schema } from "@echo/db";

type Row<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Ids fixos: o painel, os testes e os mocks das outras frentes podem contar com eles. */
export const DEMO_IDS = {
  org: "00000000-0000-4000-8000-000000000001",
  team: "00000000-0000-4000-8000-000000000010",
  people: {
    fernando: "00000000-0000-4000-8000-000000000101",
    eduardo: "00000000-0000-4000-8000-000000000102",
    yan: "00000000-0000-4000-8000-000000000103",
    marina: "00000000-0000-4000-8000-000000000104",
    bruno: "00000000-0000-4000-8000-000000000105",
    carla: "00000000-0000-4000-8000-000000000106",
    rita: "00000000-0000-4000-8000-000000000107",
  },
} as const;

export type PersonaKey = keyof typeof DEMO_IDS.people;

export const DEMO_REPO = "echo-teste/app";

export interface DemoData {
  orgs: Row<typeof schema.orgs>[];
  teams: Row<typeof schema.teams>[];
  people: Row<typeof schema.people>[];
  identities: Row<typeof schema.identities>[];
  tasks: Row<typeof schema.tasks>[];
  pullRequests: Row<typeof schema.pullRequests>[];
  dailyNotes: Row<typeof schema.dailyNotes>[];
  /** A versão 1 de cada nota é gravada junto, em `resetDemo`. */
  brainNotes: Row<typeof schema.brainNotes>[];
  workEvents: Row<typeof schema.workEvents>[];
  contributions: Row<typeof schema.contributions>[];
  questions: Row<typeof schema.questions>[];
  agentRuns: Row<typeof schema.agentRuns>[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** AAAA-MM-DD no fuso indicado. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(at));
}

/** Próxima sexta-feira (ou hoje, se já for sexta) no fuso indicado, como AAAA-MM-DD. */
function nextFriday(now: Date, timeZone: string): string {
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * DAY);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);
    if (weekday === "Fri") return localDate(d, timeZone);
  }
  return localDate(now, timeZone);
}

const weekdays = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

export function buildDemo(now: Date): DemoData {
  const P = DEMO_IDS.people;
  const org = DEMO_IDS.org;
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ahead = (ms: number) => new Date(now.getTime() + ms);
  const fortaleza = "America/Fortaleza";

  // A nota do dia de Fernando é a da última noite: a de hoje só existe depois das 18h em Fortaleza.
  const noteDay = localHour(now, fortaleza) >= 18 ? now : ago(DAY);
  const noteDate = localDate(noteDay, fortaleza);

  const orgs: DemoData["orgs"] = [
    {
      id: org,
      name: "Echo Demo",
      plan: "demo",
      isDemo: true,
      monthlyLimitUsd: "50",
      hardLimitUsd: "100",
      repositoriesOpenToTeam: [DEMO_REPO],
      // Referência para Ganhos (antes do Echo), em horas.
      gainsBaseline: { questionWaitHours: 9, firstReviewHours: 26 },
    },
  ];

  const teams: DemoData["teams"] = [{ id: DEMO_IDS.team, orgId: org, name: "Produto", leaderId: P.marina, loadLimit: 12 }];

  const person = (
    key: PersonaKey,
    name: string,
    timezone: string,
    extra: Partial<Row<typeof schema.people>> = {},
  ): Row<typeof schema.people> => ({
    id: P[key],
    orgId: org,
    teamId: DEMO_IDS.team,
    name,
    role: "member",
    timezone,
    workHours: weekdays,
    ...extra,
  });

  const people: DemoData["people"] = [
    person("fernando", "Fernando", fortaleza, {
      jobTitle: "Desenvolvedor",
      skills: ["typescript", "node", "postgres"],
      areas: ["pagamentos", "api"],
      languages: ["pt", "en"],
      awayInstructions: "Dúvida sobre branch: confira a nota do dia. Urgência em pagamentos: plantão da escala.",
    }),
    person("eduardo", "Eduardo", "Africa/Johannesburg", {
      // Começa às 8h: na cena 1 (08:12 em Joanesburgo) ele já está no expediente.
      workHours: { days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00" },
      jobTitle: "Desenvolvedor",
      skills: ["typescript", "react", "api"],
      areas: ["api", "web"],
      languages: ["pt", "en"],
    }),
    person("yan", "Yan", "Asia/Tokyo", {
      jobTitle: "Desenvolvedor",
      skills: ["react", "typescript", "testes"],
      areas: ["web"],
      languages: ["pt", "en"],
    }),
    person("marina", "Marina", "America/Sao_Paulo", {
      role: "leader",
      jobTitle: "Líder de engenharia",
      skills: ["gestao"],
      areas: ["gestao"],
      languages: ["pt", "en"],
    }),
    person("bruno", "Bruno", "America/Sao_Paulo", {
      jobTitle: "Desenvolvedor",
      skills: ["node", "infra"],
      areas: ["pagamentos", "infra"],
      languages: ["pt"],
    }),
    person("carla", "Carla", "America/Sao_Paulo", {
      jobTitle: "Desenvolvedora",
      skills: ["node", "pagamentos", "middlewares"],
      areas: ["pagamentos"],
      languages: ["pt", "en"],
    }),
    person("rita", "Rita", "America/Sao_Paulo", {
      role: "hr",
      teamId: null,
      jobTitle: "Pessoas e cultura",
      languages: ["pt"],
    }),
  ];

  const identities: DemoData["identities"] = (Object.keys(P) as PersonaKey[]).flatMap((key) => {
    const rows: Row<typeof schema.identities>[] = [
      { orgId: org, personId: P[key], platform: "slack", externalId: `U_DEMO_${key.toUpperCase()}`, login: key },
    ];
    if (key !== "rita" && key !== "marina") {
      rows.push({ orgId: org, personId: P[key], platform: "github", externalId: `demo-${key}`, login: `${key}-echo-demo` });
    }
    if (key !== "rita") {
      rows.push({ orgId: org, personId: P[key], platform: "linear", externalId: `lin_demo_${key}`, login: key });
    }
    return rows;
  });

  const task = (key: string, title: string, extra: Partial<Row<typeof schema.tasks>>): Row<typeof schema.tasks> => ({
    orgId: org,
    key,
    linearId: `lin_${key.toLowerCase()}`,
    title,
    state: "todo",
    labels: [],
    externalUpdatedAt: ago(6 * HOUR),
    ...extra,
  });

  const tasks: DemoData["tasks"] = [
    task("ECH-128", "Tratar o tempo limite na confirmação de pagamento", {
      assigneeId: P.fernando, state: "in_progress", size: 3, area: "pagamentos", labels: ["pagamentos"],
      dueDate: localDate(ahead(2 * DAY), fortaleza),
    }),
    task("ECH-131", "API v2 de pedidos", { assigneeId: P.fernando, state: "in_review", size: 3, area: "api", labels: ["api"] }),
    task("ECH-140", "Tela de histórico de pedidos", {
      assigneeId: P.yan, state: "in_progress", size: 3, area: "web", labels: ["web"], dueDate: nextFriday(now, "Asia/Tokyo"),
    }),
    task("ECH-142", "Filtros da listagem na API v2", { assigneeId: P.eduardo, state: "in_progress", size: 2, area: "api", labels: ["api"] }),
    // Bruno: acima do limite de carga, e quem sai de férias na cena 3.
    task("ECH-133", "Corrigir a ordem dos middlewares do checkout", {
      assigneeId: P.bruno, state: "in_progress", size: 3, area: "pagamentos", labels: ["pagamentos"],
    }),
    task("ECH-137", "Atualizar textos do e-mail de recibo", { assigneeId: P.bruno, state: "todo", size: 2, labels: [] }),
    task("ECH-138", "Migrar o worker para a nova fila", { assigneeId: P.bruno, state: "todo", size: 5, area: "infra", labels: ["infra"] }),
    task("ECH-139", "Estorno parcial no checkout", { assigneeId: P.bruno, state: "todo", size: 3, area: "pagamentos", labels: ["pagamentos"] }),
    task("ECH-135", "Webhook de confirmação do gateway", { assigneeId: P.carla, state: "in_progress", size: 2, area: "pagamentos", labels: ["pagamentos"] }),
    task("ECH-160", "Página de status da integração", { state: "todo", size: 2, area: "web", labels: ["web"] }),
  ];

  const pr = (number: number, extra: Partial<Row<typeof schema.pullRequests>> & Pick<Row<typeof schema.pullRequests>, "title" | "branch" | "state">): Row<typeof schema.pullRequests> => ({
    orgId: org,
    repository: DEMO_REPO,
    number,
    headSha: `demo${number}`.padEnd(40, "0"),
    externalUpdatedAt: ago(2 * HOUR),
    ...extra,
  });

  const pullRequests: DemoData["pullRequests"] = [
    pr(31, {
      title: "Ajusta o tempo limite dos pagamentos", branch: "ech-112-tempo-limite-gateway", state: "merged",
      authorId: P.carla, reviewerIds: [P.bruno], files: ["src/payments/gateway.ts", "src/payments/config.ts"],
      openedAt: ago(24 * DAY), mergedAt: ago(22 * DAY), firstHumanReviewAt: ago(23 * DAY), testsState: "passed", checksState: "success",
    }),
    pr(34, {
      title: "Webhook de confirmação do gateway", branch: "ech-135-webhook-gateway", state: "open", taskKey: "ECH-135",
      authorId: P.carla, reviewerIds: [P.fernando, P.bruno], files: ["src/payments/webhook.ts"],
      openedAt: ago(2 * DAY), testsState: "passed", checksState: "success",
    }),
    pr(36, {
      title: "Ajusta o cache da listagem", branch: "cache-listagem", state: "open",
      authorId: P.yan, reviewerIds: [P.bruno], files: ["src/web/orders/list.tsx"],
      openedAt: ago(3 * DAY), testsState: "passed", checksState: "success",
    }),
    pr(37, {
      title: "Tela de histórico de pedidos", branch: "ech-140-historico", state: "open", taskKey: "ECH-140",
      authorId: P.yan, reviewerIds: [P.bruno], files: ["src/web/orders/history.tsx"],
      openedAt: ago(3 * HOUR), testsState: "passed", checksState: "pending",
    }),
    pr(39, {
      title: "API v2 de pedidos", branch: "ech-131-api-v2", state: "open", taskKey: "ECH-131",
      authorId: P.fernando, reviewerIds: [P.eduardo], files: ["src/api/v2/orders.ts", "src/api/v2/schema.ts"],
      openedAt: ago(4 * DAY), testsState: "passed", checksState: "success",
    }),
    pr(41, {
      title: "Confirmação de pagamento assíncrona", branch: "ech-120-confirmacao-assincrona", state: "merged",
      authorId: P.fernando, reviewerIds: [P.carla], files: ["src/payments/confirm.ts"],
      openedAt: ago(6 * DAY), mergedAt: ago(1 * DAY), firstHumanReviewAt: ago(5 * DAY), testsState: "passed", checksState: "success",
    }),
    pr(44, {
      title: "Trata o tempo limite na confirmação", branch: "ech-128-tempo-limite", state: "open", taskKey: "ECH-128",
      authorId: P.fernando, reviewerIds: [P.carla], files: ["src/payments/confirm.ts", "src/payments/retry.ts"],
      openedAt: ago(1 * DAY), testsState: "failed", checksState: "failure",
    }),
  ];

  const dailyNotes: DemoData["dailyNotes"] = [
    {
      orgId: org,
      personId: P.fernando,
      date: noteDate,
      stoppedAt: "ECH-128, PR aberto, falta tratar o erro de tempo limite.",
      blocked: "Testes de integração do PR falhando desde as 16h.",
      released: [{ branch: "ech-131-api-v2", to: P.eduardo, reason: "O formato da API está fechado.", until: localDate(ahead(7 * DAY), fortaleza) }],
      reserved: [{ branch: "ech-128-tempo-limite", reason: "Até a revisão do PR sair." }],
      state: "confirmed",
      confirmedAt: ago(10 * HOUR),
    },
    {
      // Yan não confirmou: a resposta sobre ECH-140 avisa isso, e nada é liberado.
      orgId: org,
      personId: P.yan,
      date: localDate(ago(DAY), "Asia/Tokyo"),
      stoppedAt: "ECH-140, tela pronta, falta o teste de paginação.",
      released: [],
      reserved: [],
      state: "auto_unreviewed",
    },
  ];

  const note = (path: string, kind: string, content: string, extra: Partial<Row<typeof schema.brainNotes>> = {}): Row<typeof schema.brainNotes> => ({
    orgId: org,
    path,
    kind,
    content,
    visibility: "team",
    version: 1,
    ...extra,
  });

  const brainNotes: DemoData["brainNotes"] = [
    note("equipe/pagamentos/tempo-limite.md", "decisao",
      "# Tempo limite nos pagamentos\n\nO tempo limite da confirmação de pagamento é de 5 segundos, com uma nova tentativa.\n\nDecidido na revisão do PR 31.",
      { personId: P.carla }),
    note("agente-fernando/perfil.md", "perfil",
      "# Fernando\n\nDesenvolvedor em Fortaleza. Cuida de pagamentos e da API v2 de pedidos.",
      { personId: P.fernando }),
    note("agente-fernando/nao-mexer.md", "nao-mexer",
      "# Não mexer\n\n- `src/payments/retry.ts` enquanto o PR da ECH-128 estiver aberto.",
      { personId: P.fernando }),
    note(`agente-fernando/diario/${noteDate}.md`, "diario",
      "# Diário\n\nParou em: ECH-128, PR aberto, falta tratar o erro de tempo limite.\nTravou: testes de integração do PR falhando desde as 16h.",
      { personId: P.fernando, visibility: "person", managedByRule: true }),
    note("agente-carla/perfil.md", "perfil",
      "# Carla\n\nDesenvolvedora de pagamentos. Conhece bem os middlewares do checkout e o gateway.",
      { personId: P.carla }),
    note("agente-eduardo/perfil.md", "perfil",
      "# Eduardo\n\nDesenvolvedor na África do Sul. Trabalha na API v2 e no painel.",
      { personId: P.eduardo }),
    note("agente-yan/perfil.md", "perfil",
      "# Yan\n\nDesenvolvedor de interface. Cuida das telas de pedidos.",
      { personId: P.yan }),
    note("equipe/processo/revisao.md", "processo",
      "# Revisão de PR\n\nTodo PR precisa de uma revisão humana antes do merge. O Echo nunca aprova PR.",
      { personId: P.marina }),
  ];

  const workEvents: DemoData["workEvents"] = [];
  const event = (type: string, personKey: PersonaKey, when: Date, ref: string, extra: Partial<Row<typeof schema.workEvents>> = {}) => {
    workEvents.push({
      orgId: org,
      type,
      personId: P[personKey],
      repository: DEMO_REPO,
      occurredAt: when,
      source: "github",
      sourceRef: ref,
      externalLogin: `${personKey}-echo-demo`,
      attributedAt: when,
      ...extra,
    });
  };

  // Fernando: semana cheia de commits.
  for (let i = 0; i < 6; i++) {
    event("commit", "fernando", ago((i + 1) * 14 * HOUR), `commit:fernando-${i}`, { branch: i < 3 ? "ech-128-tempo-limite" : "ech-131-api-v2" });
  }
  event("pr_opened", "fernando", ago(4 * DAY), "pr:39:opened", { branch: "ech-131-api-v2", prNumber: 39, taskKey: "ECH-131" });
  event("pr_merged", "fernando", ago(1 * DAY), "pr:41:merged", { branch: "ech-120-confirmacao-assincrona", prNumber: 41 });
  event("pr_opened", "fernando", ago(1 * DAY), "pr:44:opened", { branch: "ech-128-tempo-limite", prNumber: 44, taskKey: "ECH-128" });
  // Carla: poucos commits, nenhuma entrega na semana, várias revisões.
  event("commit", "carla", ago(3 * DAY), "commit:carla-0", { branch: "ech-135-webhook-gateway" });
  event("commit", "carla", ago(2 * DAY), "commit:carla-1", { branch: "ech-135-webhook-gateway" });
  event("pr_opened", "carla", ago(2 * DAY), "pr:34:opened", { branch: "ech-135-webhook-gateway", prNumber: 34, taskKey: "ECH-135" });
  event("review", "carla", ago(5 * DAY), "review:41:carla", { prNumber: 41 });
  event("review", "carla", ago(20 * HOUR), "review:44:carla", { prNumber: 44 });
  event("review", "carla", ago(30 * HOUR), "review:36:carla", { prNumber: 36 });
  event("pr_merged", "carla", ago(22 * DAY), "pr:31:merged", { branch: "ech-112-tempo-limite-gateway", prNumber: 31 });
  // Demais pessoas.
  event("commit", "yan", ago(3 * HOUR), "commit:yan-0", { branch: "ech-140-historico" });
  event("pr_opened", "yan", ago(3 * HOUR), "pr:37:opened", { branch: "ech-140-historico", prNumber: 37, taskKey: "ECH-140" });
  event("commit", "eduardo", ago(5 * HOUR), "commit:eduardo-0", { branch: "ech-142-filtros" });
  event("commit", "bruno", ago(26 * HOUR), "commit:bruno-0", { branch: "ech-133-middlewares" });
  event("review", "bruno", ago(23 * DAY), "review:31:bruno", { prNumber: 31 });
  workEvents.push({
    orgId: org, type: "task_updated", personId: P.fernando, taskKey: "ECH-131", occurredAt: ago(4 * DAY),
    source: "linear", sourceRef: "linear:ECH-131:in_review", attributedAt: ago(4 * DAY), data: { state: "in_review" },
  });

  // Carla: 5 ajudas na semana (o "trabalho invisível" da cena 4). Só a referência, nunca o texto.
  const help = (helped: PersonaKey, kind: string, weight: string, ref: string, daysAgo: number, deliveryRef?: string): Row<typeof schema.contributions> => ({
    orgId: org,
    helperId: P.carla,
    helpedId: P[helped],
    kind,
    weight,
    source: kind === "reaction" ? "slack" : kind === "panel_confirm" ? "panel" : "github",
    sourceRef: ref,
    confirmed: true,
    occurredAt: ago(daysAgo * DAY),
    ...(deliveryRef ? { deliveryRef } : {}),
  });
  const contributions: DemoData["contributions"] = [
    help("bruno", "reaction", "medio", "slack:C_DEMO_PRODUTO:1730900000.000100", 1, "linear:ECH-133"),
    help("fernando", "review_change", "forte", "github:pr/41#review-1", 5, "github:pr/41"),
    help("yan", "review_change", "forte", "github:pr/36#review-1", 1.25, "github:pr/36"),
    help("fernando", "review_change", "forte", "github:pr/44#review-1", 0.8, "github:pr/44"),
    help("eduardo", "panel_confirm", "medio", "panel:help:eduardo-api-v2", 2, "linear:ECH-142"),
  ];

  // Histórico para Ganhos: perguntas já respondidas nas semanas anteriores.
  const questions: DemoData["questions"] = [
    {
      orgId: org, askerId: P.eduardo, ownerId: P.fernando, kind: "gemeo", channel: "painel", sourceRef: "demo:q1",
      answer: "Agente de Fernando: a branch ech-131-api-v2 está liberada para Eduardo na nota do dia confirmada.",
      sources: [{ label: "nota do dia de Fernando (confirmada)", ref: "daily_note:fernando" }],
      state: "answered", resolved: true, answeredAt: ago(3 * DAY), createdAt: ago(3 * DAY),
    },
    {
      orgId: org, askerId: P.bruno, ownerId: P.carla, kind: "gemeo", channel: "painel", sourceRef: "demo:q2",
      answer: "Agente de Carla: o PR 34 continua aberto e espera revisão.",
      sources: [{ label: "PR 34", ref: "github:pr/34" }],
      state: "answered", resolved: true, answeredAt: ago(2 * DAY), createdAt: ago(2 * DAY),
    },
    {
      orgId: org, askerId: P.carla, kind: "quem_sabe", channel: "painel", sourceRef: "demo:q3",
      answer: "Quem tem registro nesse tema: Carla (autoria do PR 31).",
      sources: [{ label: "PR 31", ref: "github:pr/31" }],
      state: "answered", resolved: false, answeredAt: ago(6 * DAY), createdAt: ago(6 * DAY),
    },
  ];

  // Algumas execuções para "Custo e execuções" já começar com conteúdo.
  const run = (flow: string, model: string | null, cost: string | null, hoursAgo: number, result = "ok"): Row<typeof schema.agentRuns> => ({
    orgId: org, flow, model, costUsd: cost, durationMs: model ? 4_200 : 35, result,
    inputTokens: model ? 3_100 : null, outputTokens: model ? 420 : null,
    tools: model ? ["get_daily_note", "get_branch_status"] : [], createdAt: ago(hoursAgo * HOUR),
  });
  const agentRuns: DemoData["agentRuns"] = [
    run("answer", "claude-sonnet-5-5", "0.018000", 72),
    run("answer", "claude-sonnet-5-5", "0.016500", 48),
    run("daily_note", "claude-haiku-5-5", "0.002100", 30),
    run("morning_plan", null, null, 20),
  ];

  return {
    orgs, teams, people, identities, tasks, pullRequests, dailyNotes,
    brainNotes, workEvents, contributions, questions, agentRuns,
  };
}
