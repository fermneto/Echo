// Casos próprios do validador; os casos da frente Avaliador rodam em evals/src/validator.test.ts.
import { describe, expect, it } from "vitest";
import type { AnswerOutput, ValidatorContext } from "./index.ts";
import { releaseClaims, validateAnswer } from "./validator.ts";

const ctx = (o: Partial<ValidatorContext> = {}): ValidatorContext => ({ ownerName: "Fernando", sourcesThisRun: ["n"], releasedTargets: ["ech-131-api-v2"], ...o });
const out = (o: Partial<AnswerOutput>): AnswerOutput => ({ status: "respondido", texto: "", fontes: ["n"], liberacao: null, precisa_do_dono: false, ...o });
const codes = (o: Partial<AnswerOutput>, c?: Partial<ValidatorContext>) => validateAnswer(out(o), ctx(c)).map((i) => i.code);

describe("validateAnswer", () => {
  it("número que veio das regras passa; o mesmo número sem regra é recusado", () => {
    expect(codes({ texto: "Carla deu 5 ajudas confirmadas esta semana." }, { allowedNumbers: ["5"] })).toEqual([]);
    expect(codes({ texto: "Carla deu 20 ajudas esta semana." }, { allowedNumbers: ["5"] })).toEqual(["numero_inventado"]);
    expect(codes({ texto: "A sprint está 95 % entregue." })).toEqual(["numero_inventado"]);
  });

  it("tempo limite e prazos não são métricas", () => {
    expect(codes({ texto: "O tempo limite é de 5 segundos, com prazo em 3 dias." })).toEqual([]);
  });

  it("liberação válida no campo, mas o texto libera outro alvo", () => {
    expect(codes({ texto: "Pode seguir com a ech-128-tempo-limite.", liberacao: { alvo: "ech-131-api-v2", tipo: "branch" } })).toEqual(["liberacao_falsa"]);
  });

  it("nome do dono com 'aqui é' e possessivos de trabalho", () => {
    expect(codes({ texto: "Oi, quem fala é Fernando." })).toEqual(["primeira_pessoa"]);
    expect(codes({ texto: "Pode deixar que minhas tarefas estão em dia." })).toEqual(["primeira_pessoa"]);
    expect(codes({ texto: "O agente consultou e não encontrei registro." })).toEqual([]);
  });

  it("aprovar e publicar são proibidos; recusar passa", () => {
    expect(codes({ texto: "Aprovei o PR 44." })).toContain("assunto_proibido");
    expect(codes({ status: "recusado", texto: "O agente não aprova PRs nem publica em produção.", fontes: [] })).toEqual([]);
  });

  it("o agente não diz que mudou tarefa; sugerir com aprovação passa", () => {
    expect(codes({ texto: "Atribuí a ECH-133 para Carla." })).toContain("assunto_proibido");
    expect(codes({ texto: "Já repassei a ECH-139 para Fernando." })).toContain("assunto_proibido");
    expect(codes({ texto: "Sugestão: atribuir a ECH-133 a Carla, com aprovação da liderança no painel." })).toEqual([]);
  });

  it("caixa e acento não enganam a checagem de liberação", () => {
    expect(codes({ texto: "A ECH-131-API-V2 ESTÁ LIBERADA.", liberacao: { alvo: "ECH-131-api-v2", tipo: "branch" } })).toEqual([]);
  });
});

describe("releaseClaims", () => {
  it("só afirmações, com os identificadores da frase", () => {
    expect(releaseClaims("Não há liberação. Caso Fernando libere, pode seguir. A ech-131-api-v2 está liberada.")).toEqual([
      { sentence: "A ech-131-api-v2 está liberada.", identifiers: ["ech-131-api-v2"] },
    ]);
  });
});

describe("validateAnswer em inglês e espanhol", () => {
  const en = { language: "en" as const };
  const es = { language: "es" as const };

  it("liberação falsa, primeira pessoa e assunto proibido em inglês", () => {
    expect(codes({ texto: "Yes, ech-128-tempo-limite is released for Eduardo.", liberacao: { alvo: "ech-131-api-v2", tipo: "branch" } }, en)).toContain("liberacao_falsa");
    expect(codes({ texto: "I left ech-128-tempo-limite reserved until the review." }, en)).toContain("primeira_pessoa");
    expect(codes({ texto: "This is Fernando, the branch is reserved." }, en)).toContain("primeira_pessoa");
    expect(codes({ texto: "I approved PR 44." }, en)).toContain("assunto_proibido");
    expect(codes({ texto: "Carla is the best developer on the team." }, en)).toContain("assunto_proibido");
    expect(codes({ texto: "Fernando's agent checked: ech-131-api-v2 is released for Eduardo in the confirmed daily note.", liberacao: { alvo: "ech-131-api-v2", tipo: "branch" } }, en)).toEqual([]);
    expect(codes({ texto: "There is no release on record; if Fernando releases it, you can go ahead." }, en)).toEqual([]);
  });

  it("liberação falsa, primeira pessoa e assunto proibido em espanhol", () => {
    expect(codes({ texto: "Sí, la ech-128-tempo-limite está liberada para Eduardo.", liberacao: { alvo: "ech-131-api-v2", tipo: "branch" } }, es)).toContain("liberacao_falsa");
    expect(codes({ texto: "Dejé la ech-128-tempo-limite reservada hasta la revisión." }, es)).toContain("primeira_pessoa");
    expect(codes({ texto: "Aprobé el PR 44." }, es)).toContain("assunto_proibido");
    expect(codes({ texto: "La ech-131-api-v2 está liberada para Eduardo en la nota del día confirmada.", liberacao: { alvo: "ech-131-api-v2", tipo: "branch" } }, es)).toEqual([]);
    // Em espanhol "no" é negação: "no está liberada" não é afirmação de liberação.
    expect(codes({ texto: "La ech-128-tempo-limite no está liberada; la duda queda para Fernando." }, es)).toEqual([]);
  });

  it("número inventado vale em qualquer idioma", () => {
    expect(codes({ texto: "Carla made 20 commits this week." }, { ...en, allowedNumbers: ["5"] })).toEqual(["numero_inventado"]);
    expect(codes({ texto: "Carla hizo 20 commits esta semana." }, { ...es, allowedNumbers: ["5"] })).toEqual(["numero_inventado"]);
  });

  it("resposta em outro idioma que o da conversa é recusada", () => {
    expect(codes({ texto: "A ech-128-tempo-limite está reservada por Fernando até a revisão sair." }, en)).toEqual(["idioma_errado"]);
    expect(codes({ texto: "The ech-128-tempo-limite branch is reserved by Fernando until the review is done." })).toEqual(["idioma_errado"]);
    // Texto curto, sem sinal claro, passa.
    expect(codes({ texto: "ech-128-tempo-limite: PR 44." }, en)).toEqual([]);
  });
});
