import type { Role } from "./demo/types";

/**
 * Quem vê cada tela (docs/produto.md → "Painel" e "Papéis"). Regra pura, testada em access.test.ts.
 * O RH nunca vê cérebros, notas do dia, tarefas nem perguntas.
 */

const ALL: readonly Role[] = ["member", "lead", "hr"];
const PEOPLE: readonly Role[] = ["member", "lead"];

export type RouteDef = { href: string; label: string; roles: readonly Role[]; demoOnly?: boolean };

export const ROUTES = {
  inicio: { href: "/", label: "Início", roles: ALL },
  escritorio: { href: "/escritorio", label: "Escritório", roles: ALL },
  plano: { href: "/plano", label: "Meu plano", roles: PEOPLE },
  notaDoDia: { href: "/nota-do-dia", label: "Nota do dia", roles: PEOPLE },
  notas: { href: "/notas", label: "Notas", roles: PEOPLE },
  equipe: { href: "/equipe", label: "Equipe", roles: ALL },
  pessoa: { href: "/pessoas", label: "Ficha da pessoa", roles: ALL },
  redistribuicao: { href: "/redistribuicao", label: "Redistribuição", roles: ["lead"] },
  relatorios: { href: "/relatorios", label: "Relatórios", roles: ALL },
  ganhos: { href: "/ganhos", label: "Ganhos", roles: ["lead", "hr"] },
  execucoes: { href: "/execucoes", label: "Custo e execuções", roles: ["lead"] },
  configuracao: { href: "/configuracao", label: "Configuração", roles: ["lead", "hr"] },
  simulador: { href: "/simulador", label: "Simulador", roles: ALL, demoOnly: true },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof ROUTES;

export const NAV_GROUPS: readonly { label: string; routes: readonly RouteId[] }[] = [
  { label: "Meu dia", routes: ["plano", "notaDoDia"] },
  { label: "Equipe", routes: ["escritorio", "equipe", "notas"] },
  { label: "Gestão", routes: ["redistribuicao", "relatorios", "ganhos", "execucoes", "configuracao"] },
  { label: "Demo", routes: ["simulador"] },
];

export function canSee(role: Role, route: RouteId, opts: { demo: boolean }): boolean {
  const def: RouteDef = ROUTES[route];
  if (def.demoOnly && !opts.demo) return false;
  return def.roles.includes(role);
}

export type NavGroup = { label: string; items: { href: string; label: string }[] };

/** Grupos de navegação de um papel, sem grupos vazios. */
export function navFor(role: Role, opts: { demo: boolean }): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.routes.filter((r) => canSee(role, r, opts)).map((r) => ({ href: ROUTES[r].href, label: ROUTES[r].label })),
  })).filter((g) => g.items.length > 0);
}

/** Perguntar ao gêmeo lê notas e tarefas: o RH não pode. */
export function canAskTwin(role: Role): boolean {
  return role !== "hr";
}
