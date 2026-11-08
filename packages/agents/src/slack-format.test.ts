import type { DigestSection } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { digestMessage } from "./away-digest.ts";
import { confirmReply, draftMessage } from "./daily-note.ts";
import { planMessage } from "./morning-plan.ts";
import { planBlocks } from "./redistribution.ts";
import { columns, esc, header, quote, section, sectionsOf } from "./slack-format.ts";

type Block = { type: string; block_id?: string; text?: { text: string }; fields?: { text: string }[]; elements?: { text?: unknown; action_id?: string }[] };

/** Os limites do Block Kit: um só que passe e o Slack recusa a mensagem inteira. */
function expectValid(blocks: unknown[]) {
  expect(blocks.length).toBeLessThanOrEqual(50);
  for (const b of blocks as Block[]) {
    if (b.type === "header") expect(b.text!.text.length).toBeLessThanOrEqual(150);
    if (b.text) expect(b.text.text.length).toBeGreaterThan(0);
    if (b.type === "section" && b.text) expect(b.text.text.length).toBeLessThanOrEqual(3000);
    for (const f of b.fields ?? []) expect(f.text.length).toBeLessThanOrEqual(2000);
  }
}

const note = {
  personId: "fernando",
  date: "2026-11-06",
  stoppedAt: "ECH-128, PR 44 aberto: falta tratar o erro.",
  blocked: "PR 44 aguarda revisão; ECH-90 passou do prazo (05/11).",
  released: [{ branch: "ech-131-api-v2", to: "eduardo", reason: "Formato fechado." }],
  reserved: [],
  state: "draft" as const,
};
const names = new Map([["fernando", "Fernando"], ["eduardo", "Eduardo"]]);

describe("blocos do Slack", () => {
  it("corta no limite e divide linhas sem quebrar nenhuma", () => {
    expect((header("x".repeat(200)) as Block).text!.text).toHaveLength(150);
    expect((section("x".repeat(4000)) as Block).text!.text).toHaveLength(3000);
    expect((columns("x".repeat(2500)) as Block).fields![0]!.text).toHaveLength(2000);
    const parts = sectionsOf(Array.from({ length: 40 }, (_, i) => `${i}-${"y".repeat(200)}`)) as Block[];
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap((p) => p.text!.text.split("\n"))).toHaveLength(40);
    expectValid(parts);
  });

  it("o corte não deixa entidade, código ou negrito pela metade", () => {
    expect((section(`${"x".repeat(2996)}&amp;zzzz`) as Block).text!.text).toBe(`${"x".repeat(2996)}…`);
    expect((section(`${"x".repeat(2990)}\`codigo-longo\``) as Block).text!.text).toBe(`${"x".repeat(2990)}…`);
    expect((section(`${"x".repeat(2990)}*negrito longo*`) as Block).text!.text).toBe(`${"x".repeat(2990)}…`);
  });

  it("a citação cobre todas as linhas", () => {
    expect(quote("a\nb")).toBe("> a\n> b");
  });

  it("a trava com & não quebra a entidade", () => {
    const { blocks } = draftMessage({ ...note, blocked: "A & B aguarda; C travou." }, names, "https://echo.test");
    expect((blocks as Block[])[3]!.text!.text).toBe(":large_yellow_circle: *O que travou*\n• A &amp; B aguarda\n• C travou");
  });

  it("plano de redistribuição escapa nomes e respeita os limites", () => {
    const lookup = { tasks: new Map([["t", { key: "ECH-1" }]]), prs: new Map(), people: [{ id: "p", name: "A<B Silva" }] };
    const blocks = planBlocks("Plano", [{ taskId: "t", toId: "p", reason: "motivo" }] as never, lookup as never, "https://echo.test/", "x");
    expectValid(blocks);
    expect(JSON.stringify(blocks)).toContain("*A&lt;B*");
    expect(JSON.stringify(blocks)).toContain("https://echo.test/redistribuicao#plano-x");
  });

  it("escapa marcação do Slack em conteúdo de terceiros", () => {
    expect(esc("<!channel> & <http://x|y>")).toBe("&lt;!channel&gt; &amp; &lt;http://x|y&gt;");
  });

  it("nota do dia: título, etiqueta do agente, travas em lista e colunas", () => {
    const { blocks } = draftMessage(note, names, "https://echo.test");
    expectValid(blocks);
    const b = blocks as Block[];
    expect(b.map((x) => x.type)).toEqual(["header", "context", "section", "section", "divider", "section", "context", "actions"]);
    expect(b[0]!.text!.text).toBe("Nota do dia, 06/11");
    expect(b[1]!.elements![0]!.text).toBe(":large_blue_circle: *RASCUNHO* · Agente de Fernando");
    expect(b[3]!.text!.text).toBe(":large_yellow_circle: *O que travou*\n• PR 44 aguarda revisão\n• ECH-90 passou do prazo (05/11)");
    expect(b[5]!.fields!.map((f) => f.text)).toEqual(["*Liberado (ainda válido)*\n`ech-131-api-v2` para Eduardo (Formato fechado)", "*Reservado*\nNada"]);
  });

  it("nota sem trava não ganha cor", () => {
    const { blocks } = draftMessage({ ...note, blocked: undefined } as never, names, "https://echo.test");
    expect((blocks as Block[])[3]!.text!.text).toBe("*O que travou*\nNada apontado pelas regras.");
  });

  it("confirmada: a etiqueta muda, o prazo sai e o botão Confirmar some", () => {
    const original = draftMessage(note, names, "https://echo.test");
    const reply = confirmReply({ status: "confirmed", note: {} as never }, original) as { blocks: Block[] };
    const all = JSON.stringify(reply.blocks);
    expect(reply.blocks[1]!.elements![0]!.text).toBe("✓ *CONFIRMADA* · Agente de Fernando");
    expect(all).not.toContain("RASCUNHO");
    expect(all).not.toContain("publicada sem conferência");
    expect(all).not.toContain("confirmar_nota");
    expect(all).toContain("Nota confirmada");
  });

  it("plano da manhã: o ponto segue o tipo do item e o texto do item é escapado", () => {
    const item = (id: string, kind: "fix_ready" | "review_request" | "ci_failed", text: string) => ({ id, kind, text, reason: "motivo", ref: id });
    const { blocks } = planMessage({ personId: "p", date: "2026-11-09", items: [item("a", "fix_ready", "Correção <pronta>"), item("b", "review_request", "Revisar"), item("c", "ci_failed", "CI")] }, "https://echo.test");
    expectValid(blocks);
    const texts = (blocks as Block[]).filter((b) => b.type === "section" && b.text!.text.startsWith(":")).map((b) => b.text!.text);
    expect(texts).toEqual([":large_blue_circle: *Correção &lt;pronta&gt;*\nmotivo", ":large_yellow_circle: *Revisar*\nmotivo", ":red_circle: *CI*\nmotivo"]);
  });

  it("resumo da ausência: seção vazia sai e lista longa não passa do limite", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, askerId: "e", kind: "nenhum", state: "answered", needsOwner: false, request: "p".repeat(190), reply: "r".repeat(190), createdAt: new Date(0) }));
    const sections = [
      { key: "propostas", title: "Propostas", total: 0, items: [] },
      { key: "respondidas", title: "Respondidas", total: 25, items: many },
    ] as unknown as DigestSection[];
    const { blocks } = digestMessage(sections, [{ id: "e", name: "Eduardo Lima" }], "https://echo.test");
    expectValid(blocks);
    const all = JSON.stringify(blocks);
    expect(all).toContain("Propostas `0`");
    expect(all).not.toContain("*Propostas*");
    expect(all).toContain(":large_blue_circle: *Respondidas*");
    expect(all).toContain("E mais 5 no painel.");
  });
});
