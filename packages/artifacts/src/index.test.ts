import { describe, expect, it } from "vitest";
import { buildDayFacts, checkSpec, defaultSpec, factsForModel, fromModelIds, noteSpecJsonSchema, specForRender, textIssues, withoutNumbers } from "./index.ts";

const day = buildDayFacts({
  pessoa: "Fernando",
  date: "2026-11-06",
  parou: ["ECH-128, PR 44 aberto: falta tratar o erro de tempo limite."],
  travou: ["PR 44 aguarda revisão; ", "ECH-131 passou do prazo (05/11)"],
  tarefas: [{ chave: "ECH-128", titulo: "Tempo limite na listagem", estado: "em andamento" }],
  prs: [{ numero: 44, titulo: "Tempo limite configurável", branch: "ech-128-tempo-limite", rascunho: false }],
  atividade: [
    { tipo: "commits", label: "Commits", value: 7 },
    { tipo: "revisoes", label: "Revisões", value: 0 },
  ],
  liberado: [{ branch: "ech-131-api-v2", detail: "para Eduardo" }],
  reservado: [],
});

describe("buildDayFacts", () => {
  it("ids estáveis por tipo; contador zerado e item vazio ficam de fora", () => {
    expect(day.facts.map((f) => f.id)).toEqual(["parou:0", "travou:0", "travou:1", "tarefa:ECH-128", "pr:44", "atividade:commits", "liberado:ech-131-api-v2"]);
    expect(day.facts.find((f) => f.id === "travou:0")!.label).toBe("PR 44 aguarda revisão");
    expect(day.facts.find((f) => f.id === "pr:44")).toMatchObject({ detail: "PR 44 · ech-128-tempo-limite", status: "aberto" });
  });
});

describe("defaultSpec", () => {
  it("um bloco por componente, na ordem padrão", () => {
    expect(defaultSpec(day).blocks.map((b) => [b.component, b.factIds.length])).toEqual([
      ["destaque", 1],
      ["lista_pendencias", 2],
      ["cartao_tarefa", 1],
      ["cartao_pr", 1],
      ["linha_do_dia", 1],
      ["quadro_liberado_reservado", 1],
    ]);
  });
});

describe("checkSpec", () => {
  const ok = {
    kind: "nota",
    blocks: [
      { component: "destaque", title: "Retomar pelo tempo limite", text: "O erro de tempo limite é o próximo passo.", factIds: ["parou:0"] },
      { component: "lista_pendencias", title: "Antes de seguir", factIds: ["travou:0", "travou:1"] },
      { component: "cartao_pr", title: "Em revisão", factIds: ["pr:44"] },
    ],
  };

  it("aceita a ordem e os títulos do modelo e completa o que ficou de fora", () => {
    const c = checkSpec(ok, day);
    expect(c.usedModel).toBe(true);
    expect(c.spec.blocks.map((b) => b.component)).toEqual(["destaque", "lista_pendencias", "cartao_pr", "cartao_tarefa", "linha_do_dia", "quadro_liberado_reservado"]);
    expect(c.spec.blocks[0]!.title).toBe("Retomar pelo tempo limite");
    expect(c.issues[0]).toMatch(/^completado por regra: tarefa:ECH-128/);
  });

  it("blocos do mesmo componente viram um só, sem o título de um deles", () => {
    const c = checkSpec({ kind: "nota", blocks: [ok.blocks[0], { component: "lista_pendencias", title: "Revisão", factIds: ["travou:0"] }, { component: "lista_pendencias", title: "Prazo", factIds: ["travou:1"] }] }, day);
    const pend = c.spec.blocks.filter((b) => b.component === "lista_pendencias");
    expect(pend).toEqual([{ component: "lista_pendencias", factIds: ["travou:0", "travou:1"] }]);
  });

  it("o modelo não esconde fato: bloqueio que ficou de fora entra no fim", () => {
    const c = checkSpec({ kind: "nota", blocks: [ok.blocks[0]] }, day);
    expect(c.spec.blocks.find((b) => b.component === "lista_pendencias")!.factIds).toEqual(["travou:0", "travou:1"]);
  });

  it("número, primeira pessoa, avaliação ou markup: o título vira o padrão e a frase sai", () => {
    for (const bad of ["Faltam 2 passos", "Onde eu parei", "Dia produtivo", "Ver **isto**"]) {
      const c = checkSpec({ kind: "nota", blocks: [{ component: "destaque", title: bad, text: bad, factIds: ["parou:0"] }] }, day);
      expect(c.usedModel).toBe(true);
      expect(c.spec.blocks[0]).toEqual({ component: "destaque", title: "Onde parou", factIds: ["parou:0"] });
      expect(c.issues[0]).toMatch(/^título trocado/);
    }
  });

  it("fato desconhecido, no componente errado ou repetido sai do bloco e volta no lugar certo", () => {
    const wrong = checkSpec({ kind: "nota", blocks: [ok.blocks[0], { component: "lista_pendencias", title: "Tarefa travada", factIds: ["tarefa:ECH-128", "parou:9"] }] }, day);
    expect(wrong.usedModel).toBe(true);
    expect(wrong.spec.blocks.map((b) => b.title)).not.toContain("Tarefa travada");
    expect(wrong.spec.blocks.find((b) => b.component === "cartao_tarefa")!.factIds).toEqual(["tarefa:ECH-128"]);
    expect(wrong.issues).toContain("fato no componente errado: tarefa:ECH-128");
    expect(wrong.issues).toContain("fato desconhecido: parou:9");
    expect(checkSpec({ kind: "nota", blocks: [ok.blocks[0], { component: "destaque", title: "y", factIds: ["parou:0"] }] }, day).issues).toContain("fato repetido: parou:0");
  });

  it("componente fora da nota, formato errado ou nenhum bloco aproveitável: layout padrão", () => {
    expect(checkSpec({ kind: "nota", blocks: [{ component: "mapa_fusos", title: "x", factIds: [] }] }, day).usedModel).toBe(false);
    expect(checkSpec({ kind: "nota", blocks: [{ component: "destaque", title: "x", factIds: ["pr:44"] }] }, day).usedModel).toBe(false);
    expect(checkSpec("texto", day)).toMatchObject({ usedModel: false, issues: ["fora do formato"], spec: defaultSpec(day) });
  });

  it("o modelo não vê números nem chaves dos fatos", () => {
    expect(withoutNumbers("ECH-128, PR 44 aberto: falta tratar o erro de tempo limite")).toBe("PR aberto: falta tratar o erro de tempo limite");
    expect(withoutNumbers("ECH-131 passou do prazo (05/11)")).toBe("passou do prazo");
    const seen = factsForModel(day).fatos;
    expect(seen.map((f) => f.texto).join(" ")).not.toMatch(/\d/);
    expect(seen.map((f) => f.id)).toEqual(["f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
    expect(fromModelIds({ kind: "nota", blocks: [{ component: "cartao_pr", factIds: ["f5", "f99"] }] }, day)).toEqual({ kind: "nota", blocks: [{ component: "cartao_pr", factIds: ["pr:44", "f99"] }] });
  });

  it("título longo é cortado, não recusado", () => {
    const c = checkSpec({ kind: "nota", blocks: [{ ...ok.blocks[0], title: "a".repeat(200) }] }, day);
    expect(c.spec.blocks[0]!.title).toHaveLength(80);
  });
});

describe("specForRender e esquema", () => {
  it("especificação gravada perde ids que sumiram e ganha fatos novos", () => {
    const stored = { kind: "nota", blocks: [{ component: "destaque", title: "Retomar", factIds: ["parou:0"] }, { component: "cartao_pr", title: "Antigo", factIds: ["pr:99"] }] };
    const spec = specForRender(stored, day);
    expect(spec.blocks[0]).toMatchObject({ component: "destaque", title: "Retomar" });
    expect(spec.blocks.find((b) => b.component === "cartao_pr")!.factIds).toEqual(["pr:44"]);
    expect(specForRender({ lixo: true }, day)).toEqual(defaultSpec(day));
  });

  it("o esquema da saída só aceita componentes da nota e ids existentes", () => {
    const s = noteSpecJsonSchema(day);
    expect(s.properties.blocks.items.properties.factIds.items.enum).toEqual(day.facts.map((f) => f.id));
    expect(s.properties.blocks.items.properties.component.enum).not.toContain("mapa_fusos");
  });

  it("textIssues", () => {
    expect(textIssues("Retomar pelo tempo limite")).toEqual([]);
    expect(textIssues("Fale com @eduardo em https://x")).toEqual(["link, menção ou marcação"]);
  });
});
