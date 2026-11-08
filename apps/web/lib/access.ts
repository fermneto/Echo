import type { AccountPlatform } from "@echo/domain";
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
  plano: { href: "/plano", label: "Meu plano", hint: "O que chegou para você hoje, em ordem de prioridade.", roles: PEOPLE },
  notaDoDia: { href: "/nota-do-dia", label: "Nota do dia", hint: "O rascunho do seu gêmeo para você conferir e publicar.", roles: PEOPLE },
  resumo: { href: "/resumos", label: "Resumo do dia", hint: "O seu dia em uma página, montado por um modelo aberto a partir de fatos.", roles: PEOPLE },
  notas: { href: "/notas", label: "Notas", hint: "O que cada gêmeo sabe, com versões e fontes.", roles: PEOPLE },
  equipe: { href: "/equipe", label: "Pessoas", hint: "Quem é quem, onde está e quando volta.", roles: ALL },
  pessoa: { href: "/pessoas", label: "Ficha da pessoa", roles: ALL },
  redistribuicao: { href: "/redistribuicao", label: "Redistribuição", hint: "Ausências viram um plano. Nada muda sem você aprovar.", roles: ["leader"] },
  equipes: { href: "/equipes", label: "Visão das equipes", hint: "Entregas, ajudas e gêmeos por equipe, só em totais.", roles: ["hr"] },
  relatorios: { href: "/relatorios", label: "Relatórios", hint: "A sua semana, conferida por você antes de seguir ao RH.", roles: ALL },
  ganhos: { href: "/ganhos", label: "Ganhos", hint: "Espera evitada e revisões, só em totais.", roles: ["leader", "hr"] },
  execucoes: { href: "/execucoes", label: "Custo e execuções", hint: "Quanto custou cada fluxo e o rastro de cada execução.", roles: ["leader"] },
  configuracao: { href: "/configuracao", label: "Configuração", hint: "Conexões, pessoas, RH e limite de custo.", roles: ["leader", "hr"] },
  simulador: { href: "/simulador", label: "Simulador", hint: "Converse pelo mesmo fluxo do Slack.", roles: ALL, demoOnly: true },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof ROUTES;

/** Grupos do menu, na ordem em que aparecem. */
export const NAV_GROUPS: readonly { label: string; routes: readonly RouteId[] }[] = [
  { label: "Meu dia", routes: ["plano", "notaDoDia", "resumo"] },
  { label: "Equipe", routes: ["equipe", "notas"] },
  { label: "Gestão", routes: ["redistribuicao", "equipes", "relatorios", "ganhos", "execucoes", "configuracao"] },
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

/**
 * Equipes que a pessoa vê.
 * - RH: as que escolheu acompanhar (sem escolha, todas). Pode trocar a qualquer momento.
 * - Membro e liderança: só a própria. Sem equipe cadastrada (empresa sem equipes), vê todas,
 *   para o painel não ficar vazio.
 */
export function visibleTeamIds(me: { role: Role; teamId?: string | undefined }, allTeamIds: readonly string[], followed?: readonly string[] | null): string[] {
  if (me.role === "hr") {
    const chosen = (followed ?? []).filter((id) => allTeamIds.includes(id));
    return followed == null ? [...allTeamIds] : chosen;
  }
  if (!me.teamId) return [...allTeamIds];
  return [me.teamId];
}

/** Quem aparece para a pessoa: ela mesma e quem é de uma equipe visível. O RH não aparece para os membros. */
export function canSeePerson(me: { id: string }, target: { id: string; teamId?: string | undefined }, visible: readonly string[]): boolean {
  if (target.id === me.id) return true;
  return Boolean(target.teamId && visible.includes(target.teamId));
}

/**
 * Quem edita o perfil (cargo, habilidades, áreas, idiomas) na ficha: o RH, a liderança da equipe da pessoa
 * e a própria pessoa.
 */
export function canEditProfile(me: { id: string; role: Role; teamId?: string | undefined }, target: { id: string; teamId?: string | undefined }): boolean {
  if (me.id === target.id || me.role === "hr") return true;
  return me.role === "leader" && Boolean(me.teamId) && me.teamId === target.teamId;
}

/**
 * Em quais plataformas cada papel liga ou troca as contas da pessoa. A conta do Slack decide quem entra no painel
 * como a pessoa e quem ela é nas menções, então só o RH liga ou troca o Slack. GitHub e Linear: o RH e a liderança
 * da equipe da pessoa (nunca a de alguém do RH). Fora do RH, ninguém mexe nas próprias contas, nem a liderança
 * sobre si: senão um líder poderia entrar no painel como outra pessoa.
 */
export function linkablePlatforms(me: { id: string; role: Role; teamId?: string | undefined }, target: { id: string; role?: Role | undefined; teamId?: string | undefined }): AccountPlatform[] {
  if (me.role === "hr") return ["slack", "github", "linear"];
  if (me.id === target.id) return [];
  if (me.role === "leader" && target.role !== "hr" && Boolean(me.teamId) && me.teamId === target.teamId) return ["github", "linear"];
  return [];
}

/** Quem vê a seção de contas da pessoa: quem liga ao menos uma plataforma. */
export function canLinkAccounts(me: { id: string; role: Role; teamId?: string | undefined }, target: { id: string; role?: Role | undefined; teamId?: string | undefined }): boolean {
  return linkablePlatforms(me, target).length > 0;
}

/** Perguntar ao gêmeo lê notas e tarefas: o RH não pode. */
export function canAskTwin(role: Role): boolean {
  return role !== "hr";
}
