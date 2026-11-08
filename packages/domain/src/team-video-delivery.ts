// Vídeo da semana da equipe no Slack: quem recebe e o texto da mensagem, por regra. Recebe quem vê o vídeo no
// painel pela equipe (os ativos da equipe e a liderança dela), menos quem está de férias ou ausente agora e quem
// não tem conta no Slack. O RH fica só no painel: as equipes que ele acompanha são escolha do navegador dele, sem
// registro no servidor, e o vídeo é da equipe. Sem nota, sem ranking e sem primeira pessoa.
import { isAway } from "./rules.ts";
import type { Absence, Person } from "./types.ts";

export type TeamVideoSkipReason = "rh" | "inativo" | "ausente" | "sem_slack";

export interface TeamVideoAudience {
  teamId: string;
  /** Líder cadastrado na equipe (`teams.leader_id`); recebe mesmo que a ficha dele seja de outra equipe. */
  leaderId?: string | null | undefined;
  people: readonly Person[];
  absences: readonly Absence[];
  /** Pessoas com conta no Slack ligada. */
  slackIds: ReadonlySet<string>;
  now: Date;
}

/** Quem vê o vídeo da equipe pela equipe: membro ou liderança dela. O RH nunca entra por aqui (vê no painel). */
export function seesTeamVideo(p: Pick<Person, "id" | "role" | "teamId">, teamId: string, leaderId?: string | null): boolean {
  if (p.role === "hr") return false;
  return p.teamId === teamId || (leaderId != null && p.id === leaderId);
}

/**
 * Quem recebe o vídeo da semana no privado do Slack, na ordem recebida. Fora: o RH (só no painel), quem não está
 * ativo, quem tem ausência agora (férias, licença, imprevisto: nunca chamar quem está de férias) e quem não tem
 * Slack. Fora do expediente recebe: a mensagem fica para quando a pessoa abrir, como o aviso do relatório.
 */
export function teamVideoRecipients(input: TeamVideoAudience): { to: string[]; skipped: { personId: string; reason: TeamVideoSkipReason }[] } {
  const to: string[] = [];
  const skipped: { personId: string; reason: TeamVideoSkipReason }[] = [];
  const absences = [...input.absences];
  const seen = new Set<string>();
  for (const p of input.people) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const inTeam = p.teamId === input.teamId || (input.leaderId != null && p.id === input.leaderId);
    if (!inTeam) continue;
    const reason: TeamVideoSkipReason | null = !seesTeamVideo(p, input.teamId, input.leaderId)
      ? "rh"
      : !p.active
        ? "inativo"
        : isAway(p, absences, input.now).reason === "absence"
          ? "ausente"
          : !input.slackIds.has(p.id)
            ? "sem_slack"
            : null;
    if (reason) skipped.push({ personId: p.id, reason });
    else to.push(p.id);
  }
  return { to, skipped };
}

/** Texto do Slack sem menção nem link vindos do nome da equipe. */
const plain = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Mensagem do vídeo da semana: nome e título do arquivo, comentário que acompanha o vídeo e a versão em texto
 * (sem permissão de arquivo no Slack). Diz que é o vídeo da semana da equipe, o período, que foi gravado por um
 * agente Claude e onde mais assistir. Em terceira pessoa, sem nota e sem ranking.
 */
export function teamVideoMessage(input: { teamName: string; weekLabel: string; week: string; reportsUrl?: string | undefined }): { filename: string; title: string; comment: string; text: string } {
  const head = `*Vídeo da semana da equipe ${plain(input.teamName)}* · ${plain(input.weekLabel)}`;
  const by = "Resumo animado da semana da equipe, gravado por um agente Claude (Powered by Claude).";
  const where = input.reportsUrl ? `no painel do Echo, em <${input.reportsUrl}|Relatórios>` : "no painel do Echo, em Relatórios";
  return {
    filename: `video-da-semana-${input.week.replace(/[^\w-]/g, "") || "equipe"}.mp4`,
    title: `Vídeo da semana · ${input.teamName} · ${input.weekLabel}`.slice(0, 200),
    comment: `${head}\n${by} Também está ${where}.`,
    text: `${head}\n${by} Assista ${where}.`,
  };
}
