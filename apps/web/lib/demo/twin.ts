import type { AnswerResult } from "@echo/agents";
import type { SourceRef } from "@echo/domain";
import type { Persona } from "./types";

/**
 * Respostas SIMULADAS do gêmeo, no formato `AnswerResult` de `@echo/agents`. Reproduz os cenários de
 * docs/produto.md → "Perguntas ao gêmeo" e "Barreiras". Com banco ligado ao painel, a pergunta vai ao
 * fluxo F2 real (lib/agent.ts); isto vale só para a demo sem banco.
 */

const EVALUATION = /\b(bom|boa|ruim|melhor|pior)\s+(funcion[aá]ri[oa]|profissional|colega)|\bavali|\branking\b|\bsal[aá]rio|\bdemi(ss|t)|\bpromo[cç]/i;
const INJECTION = /ignore\s+(suas|as)\s+regras|responda\s+como\s+o|finja|aprov(e|ar)\s+(meu|o)\s+pr/i;

type DemoFact = {
  /** A pergunta mostrada em "Experimente". Cita um item do seed, para o fluxo real responder pela mesma regra. */
  question: string;
  match: RegExp;
  text: string;
  sources: SourceRef[];
  needsOwner?: boolean;
  warnings?: string[];
};

const NOTE_FERNANDO: SourceRef = { label: "nota do dia de Fernando (confirmada)", ref: "daily_note:fernando" };
const task = (key: string): SourceRef => ({ label: `${key} no Linear (ao vivo)`, ref: `linear:${key}` });
const pr = (n: number): SourceRef => ({ label: `PR ${n} no GitHub (ao vivo)`, ref: `github:pr/${n}` });

/** O que cada agente sabe responder na demo. As sugestões da ficha saem daqui, então sempre têm resposta. */
const FACTS: Record<string, DemoFact[]> = {
  fernando: [
    {
      question: "@Fernando posso seguir com a branch ech-131-api-v2?",
      match: /ech-131/i,
      text: "Sim, para ech-131-api-v2: Fernando deixou essa branch liberada na nota do dia confirmada, porque o formato da API está fechado.",
      sources: [NOTE_FERNANDO, { label: "branch ech-131-api-v2 no GitHub", ref: "github:branch/ech-131-api-v2" }],
    },
    {
      question: "e a ech-128-tempo-limite, posso mexer?",
      match: /ech-128/i,
      text: "Não há liberação para ech-128-tempo-limite: Fernando deixou essa branch reservada na nota do dia, até a revisão do PR sair. O PR continua aberto no GitHub. A dúvida entra no plano da manhã de Fernando.",
      sources: [NOTE_FERNANDO, { label: "PR da branch ech-128-tempo-limite", ref: "github:branch/ech-128-tempo-limite" }],
      needsOwner: true,
    },
  ],
  eduardo: [
    {
      question: "Em que pé está a ECH-142?",
      match: /ech-142/i,
      text: 'A tarefa ECH-142 está "Em andamento" no Linear, com Eduardo como responsável.',
      sources: [task("ECH-142")],
    },
  ],
  yan: [
    {
      question: "@Yan o ECH-140 já terminou?",
      match: /ech-140/i,
      text: 'A tarefa ECH-140 está "Em andamento" no Linear agora, com Yan como responsável e prazo na sexta. O PR ligado está aberto, sem revisão.',
      sources: [task("ECH-140"), { label: "PR ligado no GitHub (ao vivo)", ref: "github:pr/ech-140" }],
      warnings: ["Yan não confirmou a nota do dia mais recente."],
    },
    {
      question: "Em que pé está o PR 37?",
      match: /\bpr\s*37\b/i,
      text: "O PR 37, de Yan, está aberto, na branch ech-140-historico.",
      sources: [pr(37)],
    },
  ],
  bruno: [
    {
      question: "Em que pé está a ECH-133?",
      match: /ech-133/i,
      text: 'A tarefa ECH-133 está "Em andamento" no Linear, com Bruno como responsável.',
      sources: [task("ECH-133")],
    },
    {
      question: "Em que pé está a ECH-138?",
      match: /ech-138/i,
      text: 'A tarefa ECH-138 está "A fazer" no Linear, com Bruno como responsável.',
      sources: [task("ECH-138")],
    },
  ],
  carla: [
    {
      question: "Em que pé está a ECH-135?",
      match: /ech-135/i,
      text: 'A tarefa ECH-135 está "Em andamento" no Linear, com Carla como responsável.',
      sources: [task("ECH-135")],
    },
    {
      question: "O PR 34 já foi incorporado?",
      match: /\bpr\s*34\b/i,
      text: "O PR 34, de Carla, está aberto, na branch ech-135-webhook-gateway.",
      sources: [pr(34)],
    },
  ],
};

function returnLine(p: Persona): string {
  switch (p.availability.kind) {
    case "off":
      return `${p.name} volta ${p.availability.returns}.`;
    case "vacation":
      return `${p.name} está de férias até ${p.availability.until}.`;
    case "working":
      return "";
  }
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" ");

export function askTwinDemo(p: Persona, question: string): AnswerResult {
  const reply = (text: string, opts: { sources?: SourceRef[]; needsOwner?: boolean; warnings?: string[] } = {}): AnswerResult => ({
    agentName: `Agente de ${p.name}`,
    text,
    sources: opts.sources ?? [],
    needsOwner: opts.needsOwner ?? false,
    usedModel: false,
    warnings: opts.warnings ?? [],
  });
  const back = returnLine(p);
  const q = question.trim();

  if (EVALUATION.test(q)) {
    return reply(`Sou o agente de ${p.name} e não avalio pessoas, não dou notas nem comparo colegas. Posso dizer em que ${p.name} está trabalhando, o que deixou liberado ou reservado e quando volta.`);
  }

  if (INJECTION.test(q)) {
    return reply(join(`Sou o agente de ${p.name} e não falo como ${p.name}. Também não aprovo PRs: essa decisão é sempre de uma pessoa.`, back, "A pergunta fica no plano da manhã."), {
      needsOwner: true,
    });
  }

  // Como no fluxo real, um fato registrado é respondido mesmo com a pessoa no expediente.
  const fact = FACTS[p.id]?.find((f) => f.match.test(q));
  if (fact) {
    return reply(join(fact.text, back), {
      sources: fact.sources,
      ...(fact.needsOwner ? { needsOwner: true } : {}),
      ...(fact.warnings ? { warnings: fact.warnings } : {}),
    });
  }

  if (p.availability.kind === "working") {
    return reply(`${p.name} está no expediente agora, então o agente não responde por essa pessoa. Pergunte direto a ${p.name}.`, {
      sources: [{ label: "expediente cadastrado", ref: `person:${p.id}` }],
    });
  }

  return reply(join(`Não encontrei nada sobre isso na nota do dia nem nos registros de ${p.name}, então não vou supor. A dúvida entra no plano da manhã de ${p.name}.`, back), {
    needsOwner: true,
  });
}

/** Perguntas sugeridas na ficha: só as que o agente responde com um fato registrado. Sem nenhuma, a ficha não mostra sugestões. */
export function suggestedQuestions(p: Persona): string[] {
  return (FACTS[p.id] ?? []).map((f) => f.question);
}
