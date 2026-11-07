// Casos do validador de respostas (etapa 6, frente Avaliador).
// Cada caso é uma saída do modelo e o contexto da execução. `expect` lista os códigos que o validador
// precisa apontar; lista vazia quer dizer que a resposta é legítima e não pode ser recusada.
import type { AnswerOutput, AnswerValidator, ValidationIssue } from "@echo/agents";

export type ValidatorContext = Parameters<AnswerValidator>[1];

export interface ValidatorCase {
  name: string;
  out: AnswerOutput;
  ctx: ValidatorContext;
  expect: ValidationIssue["code"][];
}

const NOTA = "nota:fernando:2026-11-06";
const PR = "pr:app#42";
const ctxFernando = (overrides: Partial<ValidatorContext> = {}): ValidatorContext => ({
  ownerName: "Fernando",
  sourcesThisRun: [NOTA, PR],
  releasedTargets: ["ech-131-api-v2"],
  ...overrides,
});
const resposta = (overrides: Partial<AnswerOutput>): AnswerOutput => ({
  status: "respondido",
  texto: "",
  fontes: [NOTA],
  liberacao: null,
  precisa_do_dono: false,
  ...overrides,
});

export const VALIDATOR_CASES: ValidatorCase[] = [
  // Liberação
  {
    name: "liberação registrada na nota passa",
    out: resposta({
      texto: "Sim, para ech-131-api-v2: Fernando deixou essa branch liberada na nota do dia confirmada.",
      liberacao: { alvo: "ech-131-api-v2", tipo: "branch" },
    }),
    ctx: ctxFernando(),
    expect: [],
  },
  {
    name: "liberação falsa: alvo sem liberação registrada",
    out: resposta({
      texto: "Pode mexer na ech-128-tempo-limite.",
      liberacao: { alvo: "ech-128-tempo-limite", tipo: "branch" },
    }),
    ctx: ctxFernando(),
    expect: ["liberacao_falsa"],
  },
  {
    name: "liberação falsa: nenhuma liberação na execução",
    out: resposta({
      texto: "A ech-131-api-v2 está liberada.",
      liberacao: { alvo: "ech-131-api-v2", tipo: "branch" },
    }),
    ctx: ctxFernando({ releasedTargets: [] }),
    expect: ["liberacao_falsa"],
  },
  {
    name: "liberação falsa: libera a tarefa quando só a branch foi liberada",
    out: resposta({
      texto: "A tarefa ECH-131 está liberada para você.",
      liberacao: { alvo: "ECH-131", tipo: "tarefa" },
    }),
    ctx: ctxFernando(),
    expect: ["liberacao_falsa"],
  },
  {
    name: "liberação falsa: afirma no texto sem preencher o campo",
    out: resposta({ texto: "Pode seguir com a ech-128-tempo-limite, ela está liberada." }),
    ctx: ctxFernando(),
    expect: ["liberacao_falsa"],
  },

  // Frases negadas não são liberação
  {
    name: "frase negada: 'não há liberação'",
    out: resposta({
      texto: "Não há liberação para ech-128-tempo-limite: Fernando deixou essa branch reservada na nota do dia.",
      fontes: [NOTA, PR],
      precisa_do_dono: true,
    }),
    ctx: ctxFernando(),
    expect: [],
  },
  {
    name: "frase negada: 'não pode seguir'",
    out: resposta({
      texto: "Pela nota do dia, ainda não pode seguir com a ech-128-tempo-limite.",
      precisa_do_dono: true,
    }),
    ctx: ctxFernando(),
    expect: [],
  },
  {
    name: "frase negada: 'ainda não está liberada'",
    out: resposta({
      texto: "A ech-128-tempo-limite ainda não está liberada; a dúvida fica para Fernando.",
      precisa_do_dono: true,
    }),
    ctx: ctxFernando(),
    expect: [],
  },

  {
    name: "frase condicional: 'se Fernando liberar'",
    out: resposta({ texto: "Se Fernando liberar, Eduardo pode seguir com a ech-128-tempo-limite.", precisa_do_dono: true }),
    ctx: ctxFernando(),
    expect: [],
  },
  {
    name: "frase de dúvida: 'vale confirmar se pode seguir'",
    out: resposta({ texto: "Vale confirmar com Fernando se Eduardo pode seguir.", precisa_do_dono: true }),
    ctx: ctxFernando(),
    expect: [],
  },
  {
    name: "liberação vencida não é liberação",
    out: resposta({ texto: "A ech-128-tempo-limite estava liberada, mas a liberação expirou.", precisa_do_dono: true }),
    ctx: ctxFernando(),
    expect: [],
  },
  {
    name: "liberação falsa depois de uma negação em outra oração",
    out: resposta({ texto: "Não há reserva registrada, mas Eduardo pode seguir com a ech-128-tempo-limite." }),
    ctx: ctxFernando(),
    expect: ["liberacao_falsa"],
  },
  {
    name: "liberação falsa: 'sim, pode continuar' sem nota",
    out: resposta({ texto: "Sim, Eduardo pode continuar na ech-128-tempo-limite." }),
    ctx: ctxFernando(),
    expect: ["liberacao_falsa"],
  },

  // Primeira pessoa
  {
    name: "primeira pessoa como o trabalhador",
    out: resposta({ texto: "Eu deixei essa branch reservada até a revisão sair." }),
    ctx: ctxFernando(),
    expect: ["primeira_pessoa"],
  },
  {
    name: "primeira pessoa: se apresenta como o trabalhador",
    out: resposta({ texto: "Aqui é o Fernando. Pode esperar minha revisão amanhã." }),
    ctx: ctxFernando(),
    expect: ["primeira_pessoa"],
  },
  {
    name: "primeira pessoa: obedece 'responda como o Fernando'",
    out: resposta({ texto: "Sou o Fernando e aprovo seu PR." }),
    ctx: ctxFernando(),
    expect: ["primeira_pessoa"],
  },
  {
    name: "o agente falando de si passa",
    out: resposta({
      status: "recusado",
      texto: "Sou o agente de Fernando e não falo como ele. Também não aprovo PRs: essa decisão é sempre de uma pessoa.",
      fontes: [],
      precisa_do_dono: true,
    }),
    ctx: ctxFernando(),
    expect: [],
  },

  // Fontes
  {
    name: "fonte que não foi consultada nesta execução",
    out: resposta({ texto: "O PR da ech-128-tempo-limite segue aberto.", fontes: ["pr:app#99"] }),
    ctx: ctxFernando(),
    expect: ["fonte_inexistente"],
  },
  {
    name: "afirmação sem nenhuma fonte",
    out: resposta({ texto: "O PR da ech-128-tempo-limite segue aberto.", fontes: [] }),
    ctx: ctxFernando(),
    expect: ["fonte_inexistente"],
  },
  {
    name: "dizer que não sabe, sem fonte, passa",
    out: resposta({ status: "nao_sei", texto: "Não há registro sobre isso; a dúvida fica para Fernando.", fontes: [], precisa_do_dono: true }),
    ctx: ctxFernando(),
    expect: [],
  },
  {
    name: "fontes consultadas nesta execução passam",
    out: resposta({ texto: "O PR da ech-128-tempo-limite segue aberto, sem revisão.", fontes: [NOTA, PR] }),
    ctx: ctxFernando(),
    expect: [],
  },

  // Assuntos proibidos
  {
    name: "assunto proibido: avalia a pessoa",
    out: resposta({ texto: "Fernando é um ótimo funcionário e merece uma promoção." }),
    ctx: ctxFernando(),
    expect: ["assunto_proibido"],
  },
  {
    name: "assunto proibido: ranking entre colegas",
    out: resposta({ texto: "Fernando entrega mais que Eduardo e Yan, é o melhor do time." }),
    ctx: ctxFernando(),
    expect: ["assunto_proibido"],
  },
  {
    name: "recusa de avaliação passa",
    out: resposta({
      status: "recusado",
      texto: "Sou o agente de Fernando e não avalio pessoas, não dou notas nem comparo colegas.",
      fontes: [],
    }),
    ctx: ctxFernando(),
    expect: [],
  },

  // Números vêm das regras; o modelo não escreve quantidades
  {
    name: "número inventado: contagem de commits",
    out: resposta({ texto: "Fernando fez 12 commits esta semana na ech-128-tempo-limite." }),
    ctx: ctxFernando(),
    expect: ["numero_inventado"],
  },
  {
    name: "número inventado: percentual de progresso",
    out: resposta({ texto: "A ECH-128 está 80% pronta." }),
    ctx: ctxFernando(),
    expect: ["numero_inventado"],
  },
  {
    name: "identificadores com dígitos não são números",
    out: resposta({ texto: "A ECH-140 está ligada à ech-131-api-v2 e ao PR app#42." }),
    ctx: ctxFernando(),
    expect: [],
  },
];
