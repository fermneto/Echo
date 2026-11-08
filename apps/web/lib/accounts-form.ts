import { ACCOUNT_LABEL, ACCOUNT_PLATFORMS, type AccountLink, type AccountPlatform, parseAccounts } from "@echo/domain";

const FIELD: Record<AccountPlatform, string> = { slack: "conta_slack", github: "conta_github", linear: "conta_linear" };

/**
 * Contas da pessoa no formulário (cadastro e ficha): `conta_slack`, `conta_github` e `conta_linear`. Campo vazio
 * = sem conta naquela plataforma. Com a lista de membros da workspace ligada, a conta do Slack precisa estar nela.
 * `allowed` são as plataformas que quem envia pode ligar (`linkablePlatforms`): campo de outra plataforma no
 * pedido é recusado, mesmo vazio, e as contas dela não entram em `links` (ficam como estão no banco).
 */
export function parseAccountsForm(form: FormData, slackMembers?: readonly { id: string }[] | null, allowed: readonly AccountPlatform[] = ACCOUNT_PLATFORMS): { ok: true; links: AccountLink[] } | { ok: false; error: string } {
  const denied = ACCOUNT_PLATFORMS.find((p) => !allowed.includes(p) && form.has(FIELD[p]));
  if (denied) return { ok: false, error: denied === "slack" ? "Só o RH liga ou troca a conta do Slack: é por ela que a pessoa entra no painel." : `Você não pode ligar a conta do ${ACCOUNT_LABEL[denied]} desta pessoa.` };
  const value = (p: AccountPlatform) => (allowed.includes(p) ? String(form.get(FIELD[p]) ?? "") : "");
  const r = parseAccounts({ slack: value("slack"), github: value("github"), linear: value("linear") });
  if (!r.ok) return r;
  const slack = r.links.find((l) => l.platform === "slack");
  if (slack && slackMembers && !slackMembers.some((m) => m.id === slack.externalId)) return { ok: false, error: "Essa conta do Slack não está na workspace ligada à empresa." };
  return r;
}

/** Mensagem para a tela quando a conta já é de outra pessoa (sem o nome: outro pedido ligou a mesma conta agora). */
export function conflictMessage(platform: string, otherName: string | null): string {
  const label = platform in ACCOUNT_LABEL ? ACCOUNT_LABEL[platform as AccountPlatform] : platform;
  if (!otherName) return `Essa conta do ${label} acabou de ser ligada a outra pessoa. Confira as contas e tente de novo.`;
  return `Essa conta do ${label} já está ligada a ${otherName}. Tire de lá primeiro, na ficha de ${otherName}.`;
}

/** Contas gravadas (readAccounts) como valores do formulário: o ID do Slack, o login do GitHub e o ID do Linear. */
export function accountValues(current: Partial<Record<AccountPlatform, { externalId: string; login: string | null }>>): { slack?: string; github?: string; linear?: string } {
  return {
    ...(current.slack ? { slack: current.slack.externalId } : {}),
    ...(current.github ? { github: current.github.login ?? current.github.externalId.replace(/^login:/, "") } : {}),
    ...(current.linear ? { linear: current.linear.externalId } : {}),
  };
}

/** Aviso quando o Slack não respondeu: a conta do Slack foi conferida só pelo formato do ID. */
export const SLACK_FORMAT_ONLY_NOTE = "O Slack não respondeu agora: a conta do Slack foi conferida só pelo formato do ID, não pela lista da workspace.";
