/**
 * Lista de membros da workspace do Slack para escolher a conta no cadastro e na ficha, sem dependência de
 * servidor (testada em slack-directory.test.ts). Quem lê o Slack de verdade é `slackDirectory`
 * (accounts-server.ts), injetado aqui como `read`.
 */
export type SlackMember = { id: string; name: string };

/**
 * - ok: a lista da workspace ligada à empresa.
 * - off: sem token do bot no painel, empresa sem Slack ligado ou token de outra workspace; a tela pede o ID.
 * - failed: o Slack não respondeu; a conta do Slack é conferida só pelo formato.
 * - demo: sessão de demonstração; o Slack real nunca é lido e a lista é vazia.
 */
export type SlackDirectory = { status: "ok"; members: SlackMember[] } | { status: "off" } | { status: "failed" } | { status: "demo"; members: SlackMember[] };

/**
 * Decide se o Slack é lido. Na demonstração, nunca (nem `users.list`); quem não pode ligar o Slack
 * (`linkablePlatforms`) também não precisa da lista.
 */
export async function slackDirectoryFor(opts: { demo: boolean; canLinkSlack: boolean; read: () => Promise<SlackDirectory> }): Promise<SlackDirectory> {
  if (opts.demo) return { status: "demo", members: [] };
  if (!opts.canLinkSlack) return { status: "off" };
  return opts.read();
}

/** Membros para a tela e para conferir o formulário; null quando não há lista (vale só o formato). */
export function membersOf(dir: SlackDirectory): SlackMember[] | null {
  return dir.status === "ok" || dir.status === "demo" ? dir.members : null;
}
