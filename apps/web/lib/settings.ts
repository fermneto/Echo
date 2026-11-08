import { RULES } from "@echo/domain";
import { ROUTES, type RouteId } from "./access";
import type { Role } from "./demo/types";

/** Regras puras da tela de Configuração, testadas em settings.test.ts. Só leitura: nada aqui muda a empresa. */

export type ConnectionKind = "github" | "slack" | "linear" | "jira" | "google" | "microsoft" | "vercel";

export const CONNECTIONS: readonly { kind: ConnectionKind; label: string; use: string }[] = [
  { kind: "github", label: "GitHub", use: "PRs, commits e a revisão da noite" },
  { kind: "slack", label: "Slack", use: "Perguntas aos agentes, avisos e login no painel" },
  { kind: "linear", label: "Linear", use: "Tarefas e redistribuição aprovada" },
  { kind: "jira", label: "Jira", use: "Tarefas e redistribuição aprovada, sozinho ou junto com o Linear" },
  { kind: "google", label: "Google Agenda", use: "Ausências e expediente sugerido" },
  { kind: "microsoft", label: "Microsoft 365", use: "Ausências e expediente sugerido" },
  { kind: "vercel", label: "Vercel", use: "Deploys das entregas no relatório" },
];

export type ConnectionState = "on" | "off" | "no_env";
export type ConnectionRow = { kind: ConnectionKind; label: string; use: string; state: ConnectionState; status: string };

const STATUS: Record<ConnectionState, string> = {
  on: "Ligado",
  off: "Não ligado",
  no_env: "Não conectado neste ambiente",
};

/**
 * Estado de cada conexão. `routes` é a rota de cada plataforma para a empresa (installation_routes);
 * `null` quando o painel não tem banco: aí nada está ligado, e a tela diz isso.
 */
export function connectionRows(routes: Partial<Record<ConnectionKind, string | null>> | null): ConnectionRow[] {
  return CONNECTIONS.map((c) => {
    const state: ConnectionState = routes === null ? "no_env" : routes[c.kind] ? "on" : "off";
    return { ...c, state, status: STATUS[state] };
  });
}

export const ROLE_LABEL: Record<Role, string> = { member: "Equipe", leader: "Liderança", hr: "RH" };
export const ROLES: readonly Role[] = ["member", "leader", "hr"];

/** Telas da matriz de acesso, na ordem do menu. Início e ficha ficam de fora. */
const MATRIX_ROUTES: readonly RouteId[] = ["plano", "notaDoDia", "notas", "equipe", "redistribuicao", "relatorios", "ganhos", "execucoes", "configuracao"];

export type AccessRow = { route: RouteId; label: string; roles: Record<Role, boolean> };

/** Quem vê cada tela, lido das mesmas regras que protegem as rotas (lib/access.ts). */
export function accessMatrix(): AccessRow[] {
  return MATRIX_ROUTES.map((route) => {
    const def = ROUTES[route];
    const roles = Object.fromEntries(ROLES.map((r) => [r, (def.roles as readonly Role[]).includes(r)])) as Record<Role, boolean>;
    return { route, label: def.label, roles };
  });
}

export type CostStep = { atUsd: number; percent: number; what: string };

/** Degraus do limite mensal, das regras fixas de custo (packages/domain). */
export function costSteps(monthlyLimitUsd: number): CostStep[] {
  const c = RULES.cost;
  return [
    { percent: c.stopFixes * 100, atUsd: monthlyLimitUsd * c.stopFixes, what: "Correções e vídeos param" },
    { percent: c.rulesOnly * 100, atUsd: monthlyLimitUsd * c.rulesOnly, what: "Só respostas por regra, sem modelo" },
    { percent: c.hardLimit * 100, atUsd: monthlyLimitUsd * c.hardLimit, what: "Ausentes respondem sem IA" },
  ];
}
