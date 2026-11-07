import { describe, expect, it } from "vitest";
import {
  cleanItems,
  demoDraft,
  demoNoteView,
  joinBlocked,
  markLine,
  MAX_ITEMS,
  parseDemoNotes,
  parseMark,
  patchFromSections,
  sectionsFromForm,
  sectionsFromNote,
  splitBlocked,
  splitStopped,
} from "./daily-note";

const people = [
  { id: "p-fer", name: "Fernando Neto" },
  { id: "p-edu", name: "Eduardo Santurbano" },
];

describe("listas da nota", () => {
  it("limpa itens vazios, espaços e excesso", () => {
    expect(cleanItems(["  a  b ", "", 3, "c"])).toEqual(["a b", "c"]);
    expect(cleanItems(Array.from({ length: 20 }, (_, i) => `x${i}`))).toHaveLength(MAX_ITEMS);
  });

  it("onde parou: uma linha por item, sem quebrar no ponto e vírgula", () => {
    expect(splitStopped("ECH-128, PR 41 aberto; falta o tempo limite.")).toEqual(["ECH-128, PR 41 aberto; falta o tempo limite."]);
    expect(splitStopped("a\n\nb")).toEqual(["a", "b"]);
    expect(splitStopped(undefined)).toEqual([]);
  });

  it("bloqueios seguem o texto da regra nos dois sentidos", () => {
    const text = "PR 44 aguarda revisão; ECH-9 passou do prazo (05/11).";
    expect(splitBlocked(text)).toEqual(["PR 44 aguarda revisão", "ECH-9 passou do prazo (05/11)"]);
    expect(joinBlocked(splitBlocked(text))).toBe(text);
    expect(joinBlocked([])).toBe("");
  });

  it("lê as listas do formulário", () => {
    const f = new FormData();
    f.append("stoppedAt", "ECH-140");
    f.append("released", " ");
    f.append("reserved", "ech-140-tela");
    expect(sectionsFromForm(f)).toEqual({ stoppedAt: ["ECH-140"], blocked: [], released: [], reserved: ["ech-140-tela"] });
  });
});

describe("marcas de branch", () => {
  it("escreve liberado com o primeiro nome e o motivo", () => {
    expect(markLine({ branch: "ech-131-api-v2", to: "p-edu", reason: "formato fechado." }, people, "released")).toBe("ech-131-api-v2 para Eduardo: formato fechado");
    expect(markLine({ branch: "ech-128", to: "p-edu" }, people, "reserved")).toBe("ech-128");
  });

  it("lê de volta, com pessoa da empresa e prazo guardado", () => {
    const stored = [{ branch: "ech-131-api-v2", until: "2026-11-10" }];
    expect(parseMark("ech-131-api-v2 para Eduardo: formato fechado", people, stored, "released")).toEqual({ branch: "ech-131-api-v2", to: "p-edu", reason: "formato fechado", until: "2026-11-10" });
    expect(parseMark("`ech-128` até a revisão sair", people, [], "reserved")).toEqual({ branch: "ech-128", reason: "até a revisão sair" });
    expect(parseMark("ech-1: ok", people, [], "released")).toEqual({ branch: "ech-1", reason: "ok" });
  });

  it("nome desconhecido não vira destinatário", () => {
    expect(parseMark("ech-1 para Zé: teste", people, [], "released")).toEqual({ branch: "ech-1", reason: "para Zé: teste" });
    expect(parseMark("   ", people, [], "released")).toBeNull();
  });

  it("nota guardada vira listas e volta ao formato da confirmação", () => {
    const note = {
      stoppedAt: "ECH-128, PR aberto.",
      blocked: "Testes do PR falhando desde as 16h.",
      released: [{ branch: "ech-131-api-v2", to: "p-edu", reason: "formato fechado" }],
      reserved: [{ branch: "ech-128-tempo-limite", reason: "até a revisão" }],
    };
    const s = sectionsFromNote(note, people);
    expect(s).toEqual({
      stoppedAt: ["ECH-128, PR aberto."],
      blocked: ["Testes do PR falhando desde as 16h"],
      released: ["ech-131-api-v2 para Eduardo: formato fechado"],
      reserved: ["ech-128-tempo-limite: até a revisão"],
    });
    expect(patchFromSections(s, people, note)).toEqual({ ...note, blocked: "Testes do PR falhando desde as 16h." });
  });
});

describe("demonstração", () => {
  it("rascunho vem da última nota do perfil ou do foco", () => {
    const last = { stoppedAt: "ECH-128", blocked: ["Testes"], released: [], reserved: ["ech-128"] };
    expect(demoDraft({ work: [], lastNote: last })).toEqual({ stoppedAt: ["ECH-128"], blocked: ["Testes"], released: [], reserved: ["ech-128"] });
    expect(demoDraft({ work: [{ title: "ECH-140 · Em andamento" }] }).stoppedAt).toEqual(["ECH-140 · Em andamento"]);
    expect(demoDraft({ focus: "Publicar a v2", work: [] }).stoppedAt).toEqual(["Publicar a v2"]);
  });

  it("cookie inválido é ignorado e o válido é limpo", () => {
    expect(parseDemoNotes("x")).toEqual({});
    expect(parseDemoNotes("[]")).toEqual({});
    const raw = JSON.stringify({ yan: { date: "2026-11-07", confirmed: true, sections: { stoppedAt: [" a "], blocked: "x" } }, bad: { date: "ontem" } });
    expect(parseDemoNotes(raw)).toEqual({ yan: { date: "2026-11-07", confirmed: true, sections: { stoppedAt: ["a"], blocked: [], released: [], reserved: [] } } });
  });

  it("confirmação de outro dia não vale hoje", () => {
    const draft = { stoppedAt: ["rascunho"], blocked: [], released: [], reserved: [] };
    const saved = { date: "2026-11-06", confirmed: true, sections: { ...draft, stoppedAt: ["ontem"] } };
    expect(demoNoteView(saved, "2026-11-07", draft)).toEqual({ date: "2026-11-07", state: "draft", sections: draft });
    expect(demoNoteView({ ...saved, date: "2026-11-07" }, "2026-11-07", draft).state).toBe("confirmed");
  });
});
