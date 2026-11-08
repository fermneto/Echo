import { type AccountLink, parseAccounts } from "@echo/domain";

/**
 * Contas da pessoa no formulário (cadastro e ficha): `conta_slack`, `conta_github` e `conta_linear`. Campo vazio
 * = sem conta naquela plataforma. Com a lista de membros da workspace ligada, a conta do Slack precisa estar nela.
 */
export function parseAccountsForm(form: FormData, slackMembers?: readonly { id: string }[] | null): { ok: true; links: AccountLink[] } | { ok: false; error: string } {
  const r = parseAccounts({ slack: String(form.get("conta_slack") ?? ""), github: String(form.get("conta_github") ?? ""), linear: String(form.get("conta_linear") ?? "") });
  if (!r.ok) return r;
  const slack = r.links.find((l) => l.platform === "slack");
  if (slack && slackMembers && !slackMembers.some((m) => m.id === slack.externalId)) return { ok: false, error: "Essa conta do Slack não está na workspace ligada à empresa." };
  return r;
}

/** Mensagem para a tela quando a conta já é de outra pessoa. */
export function conflictMessage(platform: string, otherName: string): string {
  const label = platform === "slack" ? "Slack" : platform === "github" ? "GitHub" : platform === "linear" ? "Linear" : platform;
  return `Essa conta do ${label} já está ligada a ${otherName}. Tire de lá primeiro, na ficha de ${otherName}.`;
}
