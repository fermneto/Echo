import { describe, expect, it } from "vitest";
import { addEdit, findNote, latest, MAX_NOTE, notesWith, parseEdits, TIMEOUT_NOTE } from "./notes";

const edit = (body: string) => ({ body, by: "Fernando", at: "06/11" });

describe("notas da demo", () => {
  it("cada edição vira uma versão nova, sem apagar as anteriores", () => {
    const notes = notesWith(addEdit({}, TIMEOUT_NOTE, edit("Tempo limite de 8 segundos.")));
    const note = findNote(notes, TIMEOUT_NOTE)!;
    expect(note.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(note.versions[0]!.body).toContain("5 segundos");
    expect(latest(note)).toMatchObject({ n: 2, body: "Tempo limite de 8 segundos.", by: "Fernando" });
  });

  it("edição vazia ou igual à última não cria versão", () => {
    const same = findNote(notesWith({}), TIMEOUT_NOTE)!.versions[0]!.body;
    const notes = notesWith({ [TIMEOUT_NOTE]: [edit("   "), edit(same)] });
    expect(findNote(notes, TIMEOUT_NOTE)!.versions).toHaveLength(1);
  });

  it("o cookie fora do formato é descartado, e o texto é cortado no limite", () => {
    expect(parseEdits("não é json")).toEqual({});
    expect(parseEdits(JSON.stringify({ inexistente: [edit("x")] }))).toEqual({});
    const parsed = parseEdits(JSON.stringify({ [TIMEOUT_NOTE]: [edit("a".repeat(MAX_NOTE + 50)), { body: 1 }] }));
    expect(parsed[TIMEOUT_NOTE]).toHaveLength(1);
    expect(parsed[TIMEOUT_NOTE]![0]!.body).toHaveLength(MAX_NOTE);
  });
});
