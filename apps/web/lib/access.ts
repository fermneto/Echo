import type { Role } from "./demo/types";

/**
 * Quem vê cada tela (docs/produto.md → "Painel" e "Papéis"). Regra pura, testada em access.test.ts.
 * O RH nunca vê cérebros, notas do dia, tarefas nem perguntas.
 */

const ALL: readonly Role[] = ["member", "leader", "hr"];
const PEOPLE: readonly Role[] = ["member", "leader"];

export type RouteDef = { href: string; label: string; hint?: string; roles: readonly Role[]; demoOnly?: boolean };

export const ROUTES = {
  inicio: { href: "/", label: "Início", roles: ALL },
  escritorio: { href: "/escritorio", label: "Escritório", hint: "A equipe num mapa, cada pessoa no seu fuso.", roles: ALL },
  plano: { href: "/plano", label: "Meu plano", hint: "O que chegou para você hoje, em ordem de prioridade.", roles: PEOPLE },
  notaDoDia: { href: "/nota-do-dia", label: "Nota do dia", hint: "O rascunho do seu gêmeo para você conferir e publicar.", roles: PEOPLE },
  notas: { href: "/notas", label: "Notas", hint: "O que cada gêmeo sabe, com versões e fontes.", roles: PEOPLE },
  equipe: { href: "/equipe", label: "Pessoas", hint: "Quem é quem, onde está e quando volta.", roles: ALL },
  pessoa: { href: "/pessoas", label: "Ficha da pessoa", roles: ALL },
  redistribuicao: { href: "/redistribuicao", label: "Redistribuição", hint: "Ausências viram um plano. Nada muda sem você aprovar.", roles: ["leader"] },
  relatorios: { href: "/relatorios", label: "Relatórios", hint: "A semana de cada pessoa, conferida antes do RH.", roles: ALL },
  ganhos: { href: "/ganhos", label: "Ganhos", hint: "Espera evitada e revisões, só em totais.", roles: ["leader", "hr"] },
  execucoes: { href: "/execucoes", label: "Custo e execuções", hint: "Quanto custou cada fluxo e o rastro de cada execução.", roles: ["leader"] },
  configuracao: { href: "/configuracao", label: "Configuração", hint: "Conexões, pessoas, RH e limite de custo.", roles: ["leader", "hr"] },
  simulador: { href: "/simulador", label: "Simulador", hint: "Converse pelo mesmo fluxo do Slack.", roles: ALL, demoOnly: true },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof ROUTES;

export const NAV_GROUPS: readonly { label: string; routes: readonly RouteId[] }[] = [
  { label: "Meu dia", routes: ["plano", "notaDoDia"] },
  { label: "Equipe", routes: ["equipe", "notas", "escritorio"] },
  { label: "Gestão", routes: ["relatorios", "redistribuicao", "ganhos", "execucoes", "configuracao"] },
  { label: "Demo", routes: ["simulador"] },
];

export function canSee(role: Role, route: RouteId, opts: { demo: boolean }): boolean {
  const def: RouteDef = ROUTES[route];
  if (def.demoOnly && !opts.demo) return false;
  return def.roles.includes(role);
}

export type NavGroup = { label: string; items: { href: string; label: string; hint?: string }[] };

/** Grupos de navegação de um papel, sem grupos vazios. */
export function navFor(role: Role, opts: { demo: boolean }): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.routes.filter((r) => canSee(role, r, opts)).map((r) => {
      const def: RouteDef = ROUTES[r];
      return { href: def.href, label: def.label, ...(def.hint ? { hint: def.hint } : {}) };
    }),
  })).filter((g) => g.items.length > 0);
}

/** Perguntar ao gêmeo lê notas e tarefas: o RH não pode. */
export function canAskTwin(role: Role): boolean {
  return role !== "hr";
}
