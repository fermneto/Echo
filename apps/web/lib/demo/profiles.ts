import type { Persona } from "./types";

/**
 * Perfil exibido na ficha da pessoa. SINTÉTICO até o cérebro (packages/brain) e os conectores
 * da Frente 2 trazerem tarefas, PRs, notas e contexto reais.
 */

export type Profile = {
  focus?: string;
  work: { title: string; meta: string }[];
  activity?: string;
  lastNote?: { date: string; stoppedAt: string; blocked: string[]; released: string[]; reserved: string[] };
  notes: { title: string; excerpt: string; tags: string[] }[];
  howToTalk?: string;
  whenAway?: string;
  skills: { label: string; items: string[] }[];
  about?: string;
  tools: string[];
  languages: string[];
};

const PROFILES: Record<string, Profile> = {
  fernando: {
    focus: "Tratar o tempo limite nas chamadas de pagamento (ECH-128).",
    work: [
      { title: "ECH-128 · Tratar tempo limite na integração de pagamentos", meta: "Em andamento · prazo sexta" },
      { title: "PR 41 · ech-128-tempo-limite", meta: "Aberto · testes falhando · correção pronta esta noite" },
      { title: "ECH-131 · Versão 2 da API de pedidos", meta: "Liberada para Eduardo" },
    ],
    activity: "7 commits nos últimos 7 dias, registrados no GitHub.",
    lastNote: {
      date: "05/11",
      stoppedAt: "ECH-128, PR 41 aberto; falta tratar o erro de tempo limite.",
      blocked: ["Os testes do PR 41 falham até o tempo limite ser tratado."],
      released: ["Eduardo pode seguir com a ech-131-api-v2: o formato da API está fechado."],
      reserved: ["ech-128-tempo-limite, até a revisão do PR sair."],
    },
    notes: [
      { title: "Tempo limite nos pagamentos", excerpt: "Chamadas ao provedor usam tempo limite de 5 segundos, com uma nova tentativa.", tags: ["decisão"] },
      { title: "Módulo de pagamentos", excerpt: "Reservado até a revisão do PR 41. Mudanças aqui conflitam com o tempo limite em andamento.", tags: ["não mexer"] },
      { title: "ECH-131: formato da API v2", excerpt: "Contrato fechado na quinta. Pode seguir sem Fernando.", tags: ["registro"] },
    ],
    howToTalk: "Dúvidas de pagamento no canal da equipe. Incidente em produção: marque a Marina.",
    whenAway: "Consulte a nota do dia. Nada no módulo de pagamentos muda sem revisão.",
    skills: [
      { label: "Referência", items: ["TypeScript", "integração com pagamentos"] },
      { label: "No dia a dia", items: ["Postgres", "Node.js"] },
      { label: "Aprendendo", items: ["observabilidade"] },
    ],
    about: "Cuida das integrações de pagamento e de faturas, do provedor até a conciliação.",
    tools: ["GitHub", "Linear", "Grafana"],
    languages: ["Português", "Inglês"],
  },
  eduardo: {
    focus: "Publicar a versão 2 da API de pedidos (ECH-131).",
    work: [
      { title: "ECH-131 · Publicar a versão 2 da API de pedidos", meta: "Em andamento · liberada por Fernando" },
      { title: "Revisão do PR 34, de Carla", meta: "Esperando há 2 dias" },
    ],
    activity: "5 commits nos últimos 7 dias, registrados no GitHub.",
    notes: [{ title: "ECH-131: rollout da v2", excerpt: "Publicar atrás de uma flag e acompanhar os erros por 24 h.", tags: ["registro"] }],
    howToTalk: "No canal da equipe, de manhã em Joanesburgo.",
    whenAway: "O gêmeo responde sobre a ECH-131 e as revisões pendentes.",
    skills: [
      { label: "Referência", items: ["APIs", "integrações"] },
      { label: "No dia a dia", items: ["TypeScript", "Postgres"] },
    ],
    about: "Cuida da API de pedidos e das integrações com parceiros.",
    tools: ["GitHub", "Linear"],
    languages: ["Português", "Inglês"],
  },
  yan: {
    work: [{ title: "ECH-140 · Em andamento", meta: "Prazo sexta · PR ligado aberto, sem revisão" }],
    notes: [],
    whenAway: "De férias até segunda. O gêmeo responde e ninguém é chamado.",
    skills: [{ label: "No dia a dia", items: ["TypeScript", "React"] }],
    about: "Desenvolvedor da equipe.",
    tools: ["GitHub", "Linear"],
    languages: ["Português", "Inglês"],
  },
  marina: {
    work: [{ title: "Plano para as férias de Bruno (10 a 21/11)", meta: "Esperando aprovação" }],
    notes: [],
    howToTalk: "Incidentes em produção e redistribuição de tarefas.",
    skills: [{ label: "Referência", items: ["liderança técnica", "plataforma"] }],
    about: "Lidera a equipe de plataforma.",
    tools: ["Linear", "GitHub"],
    languages: ["Português", "Inglês"],
  },
  bruno: {
    work: [{ title: "ECH-133 · Pagamentos", meta: "Vai para Carla durante as férias" }],
    notes: [],
    skills: [{ label: "No dia a dia", items: ["pagamentos"] }],
    tools: ["GitHub", "Linear"],
    languages: ["Português"],
    whenAway: "De férias de 10 a 21/11; as tarefas seguem o plano aprovado.",
  },
  carla: {
    work: [
      { title: "ECH-135 · Em andamento", meta: "Pagamentos" },
      { title: "PR 34", meta: "Esperando revisão há 2 dias" },
    ],
    activity: "Poucos commits nesta semana e 5 ajudas confirmadas a colegas.",
    notes: [],
    skills: [{ label: "Referência", items: ["pagamentos"] }],
    tools: ["GitHub", "Linear"],
    languages: ["Português", "Inglês"],
  },
  rita: { work: [], notes: [], skills: [], about: "Pessoas e cultura.", tools: [], languages: ["Português", "Inglês"] },
};

export function profileFor(p: Persona): Profile {
  return PROFILES[p.id] ?? { work: [], notes: [], skills: [], about: `${p.title}. Persona simulada, sem trabalho registrado na demo.`, tools: [], languages: [] };
}
