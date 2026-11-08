// Vídeo da semana da equipe no Slack: onde sai e o texto da mensagem, por regra. Sai numa postagem só, no canal
// da equipe (ou no canal de reserva da empresa), para a equipe assistir e comentar junto na thread. Sem canal, o
// vídeo fica só no painel: nunca vai para o privado de ninguém. Sem menção a todos, sem nota, sem ranking e sem
// primeira pessoa.

/** Id de canal público do Slack, como aparece em "Copiar link" (C seguido de letras maiúsculas e números). */
const CHANNEL_ID = /^C[A-Z0-9]{8,12}$/;

/** Confere o id colado ou escolhido no painel. Devolve o id limpo, ou `null` se não for um canal público. */
export function parseSlackChannelId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  return CHANNEL_ID.test(v) ? v : null;
}

/**
 * Canal do vídeo da semana: o da equipe; sem ele, o de reserva da empresa (vale também para empresa sem equipes);
 * sem nenhum, `null` e o vídeo fica só no painel.
 */
export function teamVideoChannel(input: { teamChannel?: string | null | undefined; orgChannel?: string | null | undefined }): string | null {
  return parseSlackChannelId(input.teamChannel) ?? parseSlackChannelId(input.orgChannel);
}

/** Chave da postagem: uma por vídeo, nunca duas. */
export const teamVideoPostKey = (videoId: string) => `team_video:${videoId}:canal`;

/** Texto do Slack sem menção, link nem aviso a todos vindos do nome da equipe ou do período. */
const plain = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@(channel|here|everyone)\b/gi, "@​$1");

/**
 * Mensagem do vídeo da semana no canal: nome e título do arquivo, comentário que acompanha o vídeo e a versão em
 * texto (sem permissão de arquivo no Slack). Diz que é o vídeo da semana da equipe, o período, que foi gravado por
 * um agente Claude, convida a comentar na thread e diz onde mais assistir. Em terceira pessoa, sem nota e sem ranking.
 */
export function teamVideoMessage(input: { teamName: string; weekLabel: string; week: string; reportsUrl?: string | undefined }): { filename: string; title: string; comment: string; text: string } {
  const head = `*Vídeo da semana da equipe ${plain(input.teamName)}* · ${plain(input.weekLabel)}`;
  const by = "Resumo animado da semana, gravado por um agente Claude (Powered by Claude).";
  const where = input.reportsUrl ? `no painel do Echo, em <${input.reportsUrl}|Relatórios>` : "no painel do Echo, em Relatórios";
  return {
    filename: `video-da-semana-${input.week.replace(/[^\w-]/g, "") || "equipe"}.mp4`,
    title: `Vídeo da semana · ${input.teamName} · ${input.weekLabel}`.slice(0, 200),
    comment: `${head}\n${by} Comentem aqui na thread. Também está ${where}.`,
    text: `${head}\n${by} Assista ${where} e comentem aqui na thread.`,
  };
}
