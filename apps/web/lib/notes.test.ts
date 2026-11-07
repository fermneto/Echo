import { describe, expect, it } from "vitest";
import { authorLabel, groupByOwner, joinNote, kindLabel, noteVersions, splitNote } from "./notes";

describe("notas do cérebro no painel", () => {
  it("separa título e texto, e volta ao mesmo formato", () => {
    const content = "# Tempo limite nos pagamentos\n\nChamadas ao provedor usam 5 segundos.\n";
    const s = splitNote(content, "equipe/pagamentos/tempo-limite.md");
    expect(s).toEqual({ title: "Tempo limite nos pagamentos", body: "Chamadas ao provedor usam 5 segundos.", hasHeading: true });
    expect(joinNote(s.title, s.body, s.hasHeading)).toBe(content);
  });

  it("sem título, vale o nome do arquivo", () => {
    expect(splitNote("Só o texto.", "agente-yan/registros/cores-do-painel.md")).toEqual({ title: "Cores do painel", body: "Só o texto.", hasHeading: false });
    expect(joinNote("Cores do painel", " Novo texto ", false)).toBe("Novo texto\n");
  });

  it("tipos e autoria legíveis; o agente se identifica", () => {
    expect(kindLabel("nao-mexer")).toBe("não mexer");
    expect(kindLabel("outro")).toBe("outro");
    expect(authorLabel("person", "Fernando")).toBe("Fernando");
    expect(authorLabel("agent", "Fernando")).toBe("Agente de Fernando");
    expect(authorLabel("mirror", "Fernando")).toBe("espelho do Git");
  });

  it("versões em ordem crescente, só com o texto", () => {
    const v = noteVersions(
      [
        { version: 2, content: "# T\n\nNovo", authorKind: "person", createdAt: new Date("2026-11-07T12:00:00Z") },
        { version: 1, content: "# T\n\nAntigo", authorKind: "agent", createdAt: new Date("2026-11-03T12:00:00Z") },
      ],
      "a/t.md",
      "Fernando",
      "America/Fortaleza",
    );
    expect(v).toEqual([
      { n: 1, body: "Antigo", by: "Agente de Fernando", at: "03/11" },
      { n: 2, body: "Novo", by: "Fernando", at: "07/11" },
    ]);
  });

  it("agrupa pela dona: quem vê primeiro, sem dona por último", () => {
    const names = new Map([
      ["c", "Carla"],
      ["f", "Fernando"],
      ["y", "Yan"],
    ]);
    const g = groupByOwner([{ personId: "f" }, { personId: undefined }, { personId: "y" }, { personId: "c" }, { personId: "f" }], names, "y");
    expect(g.map((x) => [x.name, x.notes.length])).toEqual([
      ["Yan", 1],
      ["Carla", 1],
      ["Fernando", 2],
      ["Equipe", 1],
    ]);
  });
});
