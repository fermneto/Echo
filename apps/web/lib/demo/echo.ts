import type { AnswerResult } from "@echo/agents";
import type { SourceRef } from "@echo/domain";
import { dueLabel, ECH_128_DUE } from "../due";
import { WAITING } from "./feed";
import { findNote, latest, notesWith, TIMEOUT_NOTE, type Note } from "./notes";
import type { Persona } from "./types";

/**
 * Respostas SIMULADAS do Echo como agente da equipe (pergunta livre, F2b), a partir dos
 * cenários de docs/produto.md. Quando o fluxo real existir, a ação do painel chama o fluxo.
 */

const names = (list: string[]) => (list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} e ${list.at(-1)}`);

export function askEchoDemo(question: string, team: readonly Persona[], notes: readonly Note[] = notesWith({})): AnswerResult {
  const reply = (text: string, sources: SourceRef[] = []): AnswerResult => ({ agentName: "Echo", text, sources, needsOwner: false, usedModel: false, warnings: [] });
  const q = question.trim().toLowerCase();

  if (/expediente|dispon[ií]ve|quem est[aá] (trabalhando|online)|quantas pessoas/.test(q)) {
    const on = team.filter((p) => p.availability.kind === "working").map((p) => p.name);
    const away = team.length - on.length;
    return reply(
      on.length
        ? `Agora ${on.length} ${on.length === 1 ? "pessoa está" : "pessoas estão"} no expediente: ${names(on)}. As outras ${away} estão fora, e o gêmeo de cada uma responde por ela.`
        : `Ninguém está no expediente agora. Os ${away} gêmeos respondem pela equipe.`,
      [{ label: "expedientes e ausências cadastrados", ref: "team:schedule" }],
    );
  }

  if (/pagamento|payment|billing/.test(q)) {
    const note = findNote(notes, TIMEOUT_NOTE)!;
    const v = latest(note);
    return reply(
      `Quem tem registro nesse tema: Fernando, na nota "${note.title}": ${v.body} Carla, autora do PR 31, disponível agora. Bruno, revisor do PR 31, acima do limite de carga.`,
      [
        { label: `nota "${note.title}", versão ${v.n}${v.n > 1 ? `, corrigida por ${v.by}` : ""}`, ref: `note:${note.id}@${v.n}` },
        { label: "PR 31 no GitHub", ref: "github:pr/31" },
      ],
    );
  }

  if (/ech-160/.test(q)) {
    return reply("A ECH-160 está sem responsável no Linear. A liderança pode distribuí-la em Redistribuição.", [{ label: "ECH-160 no Linear", ref: "linear:ECH-160" }]);
  }

  if (/pendente|esperando|aguardando/.test(q)) {
    const list = WAITING.filter((w) => !w.leaderOnly).map((w) => `${w.text} (${w.id})`);
    return reply(`Há ${list.length} itens esperando alguém. ${list.join(". ")}.`, [{ label: "plano da manhã e registros da equipe", ref: "team:waiting" }]);
  }

  if (/\bprs?\b|pull request|revis[aã]o/.test(q)) {
    return reply("Há 2 PRs esperando revisão: o PR 34, de Carla, aberto há 2 dias, e o PR 37, de Yan, aberto hoje.", [
      { label: "PR 34", ref: "github:pr/34" },
      { label: "PR 37", ref: "github:pr/37" },
    ]);
  }

  if (/atras|prazo/.test(q)) {
    const due = dueLabel(ECH_128_DUE, new Date(), "America/Fortaleza");
    const late = due.startsWith("venceu");
    return reply(
      late ? `A ECH-128, de Fernando, ${due} e segue em andamento. É a única tarefa da equipe fora do prazo.` : `Nenhuma tarefa passou do prazo. A ECH-128, de Fernando, ${due} e está em andamento.`,
      [{ label: "ECH-128 no Linear", ref: "linear:ECH-128" }],
    );
  }

  if (/sabe de|entende de/.test(q)) return reply("Ninguém tem registro nesse tema.");

  return reply("Não encontrei isso nos registros da equipe, então não vou supor. Tente perguntar sobre quem está disponível, pendências, PRs ou quem sabe de um tema.");
}

export const ECHO_SUGGESTIONS = ["Quem está no expediente agora?", "Alguém deixou algo pendente?", "O que está atrasado?", "Quais PRs estão abertos?", "Quem sabe de pagamentos?"];
