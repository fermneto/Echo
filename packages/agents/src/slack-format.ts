// Blocos das mensagens privadas do Slack. Mesma linguagem do painel: neutro, fios finos e cor só para estado.
// O Slack não aceita cor própria em bloco, então o estado vem como ponto, sempre com o mesmo sentido.

/** Azul: o agente preparou ou cobriu. Âmbar: espera alguém. Vermelho: falhou ou passou do prazo. */
export const DOT = { agent: ":large_blue_circle:", wait: ":large_yellow_circle:", error: ":red_circle:" } as const;

/** Limites do Block Kit: o Slack recusa a mensagem inteira (invalid_blocks) se um deles passar. */
const MAX_HEADER = 150;
const MAX_SECTION = 3_000;
const MAX_FIELD = 2_000;

/** Corta sem deixar entidade, link, código ou negrito pela metade, o que desfaria a formatação do fim do bloco. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = text.slice(0, max - 1).replace(/(&[a-z]*|<[^>]*)$/, "");
  for (const mark of ["`", "*"]) if (out.split(mark).length % 2 === 0) out = out.slice(0, out.lastIndexOf(mark));
  return `${out}…`;
}

/** Conteúdo de terceiros em texto mrkdwn: sem isso, `<!channel>` ou `<url|texto>` viram marcação. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Citação em todas as linhas: o `>` do Slack só vale para a linha em que está. */
export const quote = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

export const header = (text: string) => ({ type: "header", text: { type: "plain_text", text: cut(text, MAX_HEADER) } });
export const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text: cut(text, MAX_SECTION) } });
export const divider = () => ({ type: "divider" });
export const context = (text: string, blockId?: string) => ({ type: "context", ...(blockId ? { block_id: blockId } : {}), elements: [{ type: "mrkdwn", text: cut(text, MAX_SECTION) }] });

/** Colunas lado a lado (até 10 itens). */
export const columns = (...cols: string[]) => ({ type: "section", fields: cols.slice(0, 10).map((text) => ({ type: "mrkdwn", text: cut(text, MAX_FIELD) })) });

/** Etiqueta de estado logo abaixo do título: ponto, estado em maiúsculas e o detalhe. */
export const statusTag = (dot: string, label: string, detail: string, blockId?: string) => context(`${dot} *${label}* · ${detail}`, blockId);

export const actions = (...elements: unknown[]) => ({ type: "actions", elements });
export const linkButton = (actionId: string, label: string, url: string, primary = false) => ({ type: "button", action_id: actionId, ...(primary ? { style: "primary" } : {}), text: { type: "plain_text", text: label }, url });

/** Linhas em quantas seções forem precisas, sem quebrar uma linha ao meio. */
export function sectionsOf(lines: string[]): unknown[] {
  const out: unknown[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > MAX_SECTION) {
      out.push(section(current));
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) out.push(section(current));
  return out;
}
