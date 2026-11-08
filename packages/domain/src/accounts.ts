// Contas da pessoa nas plataformas (tabela identities): é por elas que o Echo sabe quem é quem no Slack, no
// GitHub e no Linear. Sem a do Slack, a pessoa existe só no painel: não entra pelo login, não é reconhecida nas
// menções e não recebe nada no privado. Quem informa é o RH ou a liderança; nada é adivinhado (nem pelo nome).
// Aqui só a conferência do formato, sem rede: se a conta existe na workspace, quem confere é o painel.

export const ACCOUNT_PLATFORMS = ["slack", "github", "linear"] as const;
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number];

/** Uma linha de identities. GitHub vai como `login:<minúsculas>`, igual a `pnpm integracoes:ligar`. */
export interface AccountLink {
  platform: AccountPlatform;
  externalId: string;
  login: string | null;
}

export const ACCOUNT_LABEL: Record<AccountPlatform, string> = { slack: "Slack", github: "GitHub", linear: "Linear" };

/** Id de usuário do Slack (U… ou W… nas Enterprise Grid). */
const SLACK_ID = /^[UW][A-Z0-9]{6,20}$/;
/** Login do GitHub: letras, números e hífens, sem começar nem terminar em hífen, até 39. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
/** Id de usuário do Linear (UUID). */
const LINEAR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccountInput = Partial<Record<AccountPlatform, string | null | undefined>>;

/**
 * Confere e normaliza as contas informadas. Campo vazio = sem conta naquela plataforma. Devolve a mensagem em
 * português para a tela no primeiro erro. O `@` e o endereço do perfil do GitHub são aceitos e limpos.
 */
export function parseAccounts(input: AccountInput): { ok: true; links: AccountLink[] } | { ok: false; error: string } {
  const links: AccountLink[] = [];
  const slack = (input.slack ?? "").trim().toUpperCase();
  if (slack) {
    if (!SLACK_ID.test(slack)) return { ok: false, error: "Conta do Slack inválida: use o ID do membro (começa com U), em Perfil → ⋮ → Copiar ID do membro." };
    links.push({ platform: "slack", externalId: slack, login: null });
  }
  const github = (input.github ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  if (github) {
    if (!GITHUB_LOGIN.test(github)) return { ok: false, error: "Login do GitHub inválido: só letras, números e hífens, até 39." };
    links.push({ platform: "github", externalId: `login:${github.toLowerCase()}`, login: github });
  }
  const linear = (input.linear ?? "").trim().toLowerCase();
  if (linear) {
    if (!LINEAR_ID.test(linear)) return { ok: false, error: "Conta do Linear inválida: use o ID do usuário (formato 8-4-4-4-12)." };
    links.push({ platform: "linear", externalId: linear, login: null });
  }
  return { ok: true, links };
}

/** O que mostrar quando falta a conta do Slack (cadastro e ficha). */
export const NO_SLACK_NOTE = "Sem conta do Slack: a pessoa existe só no painel. Ela não entra pelo login, não é reconhecida nas menções e não recebe nada no privado até a conta ser ligada na ficha.";
