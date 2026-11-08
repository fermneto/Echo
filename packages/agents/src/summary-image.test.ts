// Render de verdade (satori + resvg): sai um PNG, com e sem modelo, e com texto acentuado.
// E nada sai cortado: todo texto cabe na largura da sua caixa e a altura da imagem acompanha o conteúdo.
import { buildDayFacts, type DayInput, defaultSpec } from "@echo/artifacts";
import { describe, expect, it } from "vitest";
import type { StoredArtifact } from "./day-summary.ts";
import { MAX_ITEMS_PER_BLOCK, renderSummaryPng, renderSummarySvg } from "./summary-image.ts";

type Box = { left: number; top: number; width: number; height: number; text: string };

/** Renderiza e confere a geometria: cada traço de letra fica dentro da caixa de texto onde começa, e tudo dentro do canvas. */
async function layout(a: StoredArtifact) {
  const boxes: Box[] = [];
  const { svg, width, height } = await renderSummarySvg(a, {
    stateLabel: "Resumo",
    onNode: (n) => {
      if (typeof n.textContent === "string") boxes.push({ left: n.left, top: n.top, width: n.width, height: n.height, text: n.textContent });
    },
  });
  // Letras viram <path fill d="M1 2L3 4Q..."> só com comandos absolutos; fundos e bordas usam comandos relativos (h, v, a).
  const glyphs = [...svg.matchAll(/<path fill="[^"]+" d="(M[-\d. MLQCZ]+)"\/>/g)].map((m) => {
    const n = (m[1]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0);
    const ys = n.filter((_, i) => i % 2 === 1);
    return { x0: xs[0]!, y0: ys[0]!, minX: Math.min(...xs), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  });
  const problems: string[] = [];
  for (const g of glyphs) {
    const owner = boxes
      .filter((b) => g.x0 >= b.left - 2 && g.x0 <= b.left + b.width + 2 && g.y0 >= b.top - 2 && g.y0 <= b.top + b.height + 2)
      .sort((p, q) => p.width * p.height - q.width * q.height)[0];
    if (!owner) problems.push(`letra sem caixa em ${g.x0},${g.y0}`);
    else if (g.minX < owner.left - 1 || g.maxX > owner.left + owner.width + 1) problems.push(`"${owner.text.slice(0, 40)}" passa da largura (${g.maxX.toFixed(0)} > ${(owner.left + owner.width).toFixed(0)})`);
    if (g.maxX > width || g.maxY > height) problems.push(`letra fora do canvas em ${g.maxX},${g.maxY}`);
  }
  for (const b of boxes) if (b.left < 0 || b.left + b.width > width + 0.5 || b.top + b.height > height + 0.5) problems.push(`caixa "${b.text.slice(0, 40)}" fora do canvas`);
  return { height, boxes, glyphs: glyphs.length, problems };
}

const artifact = (input: DayInput): StoredArtifact => {
  const day = buildDayFacts(input);
  return { spec: defaultSpec(day), facts: day, state: "fallback" };
};

const LONGO = "Reserva de estoque do catálogo com bloqueio otimista, novas tentativas exponenciais e registro detalhado de conflitos entre pedidos simultâneos";
// Sem hífen nem barra: só quebra com wordBreak.
const BRANCH = "feature/reservaDeEstoqueDoCatalogoComBloqueioOtimistaENovasTentativasExponenciaisSemNenhumPontoDeQuebra";

const base: DayInput = {
  pessoa: "Yan",
  date: "2026-11-07",
  parou: ["ECH-5 em andamento: falta a mensagem de erro do CPF"],
  travou: ["PR 12 aguarda revisão"],
  tarefas: [{ chave: "ECH-5", titulo: "Validação do formulário de cadastro", estado: "em andamento" }],
  prs: [{ numero: 12, titulo: "Validação de CPF", branch: "ech-5-cpf", rascunho: false }],
  atividade: [{ tipo: "tarefas", label: "Tarefas concluídas", value: 1 }],
  liberado: [],
  reservado: [{ branch: "ech-5-cpf", detail: "Até a revisão" }],
};

// Caso real que saiu cortado no Slack (Fernando, 08/11, empresa de teste; dados sintéticos).
const real: StoredArtifact = {
  spec: {
    kind: "nota",
    blocks: [
      { component: "destaque", title: "PRs abertos não fechados", text: "Falta revisar e fechar dois PRs ativos", factIds: ["parou:0"] },
      { component: "linha_do_dia", title: "Atividades diárias", text: "Commit e PRs em andamento", factIds: ["atividade:commits", "atividade:prs"] },
      { component: "cartao_pr", title: "Pull requests abertos", factIds: ["pr:3", "pr:1"] },
    ],
  },
  facts: {
    pessoa: "Fernando",
    date: "2026-11-08",
    facts: [
      { id: "parou:0", kind: "parou", label: "PR 3 aberto (reserva de estoque do catálogo) e PR 1 aberto (cliente HTTP com novas tentativas): falta revisar e fechar os dois PRs" },
      { id: "pr:3", kind: "pr", label: "Reserva de estoque do catálogo", detail: "PR 3 · estoque-reserva", status: "aberto" },
      { id: "pr:1", kind: "pr", label: "Cliente HTTP do catálogo com novas tentativas", detail: "PR 1 · cliente-http-tempo-limite", status: "aberto" },
      { id: "atividade:commits", kind: "atividade", label: "Commits", value: 3 },
      { id: "atividade:prs", kind: "atividade", label: "PRs abertos ou mesclados", value: 2 },
    ],
  },
  state: "rendered",
  model: "qwen3:4b-instruct",
};

describe("renderSummaryPng", () => {
  it("gera um PNG do resumo", async () => {
    const png = await renderSummaryPng(artifact(base), { stateLabel: "Resumo" });
    expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(png.length).toBeGreaterThan(20_000);
  }, 30_000);

  it("PNG tem a altura do conteúdo, em 2x", async () => {
    const { height } = await renderSummarySvg(real);
    const png = await renderSummaryPng(real);
    expect(png.readUInt32BE(16)).toBe(2400);
    expect(png.readUInt32BE(20)).toBe(Math.ceil(height * 2));
  }, 30_000);
});

describe("imagem sem corte", () => {
  it("caso real de 08/11: todos os textos dentro da caixa e do canvas", async () => {
    const r = await layout(real);
    expect(r.glyphs).toBeGreaterThanOrEqual(r.boxes.length - 1);
    expect(r.problems).toEqual([]);
    // O último cartão de PR, que saía cortado, está inteiro.
    const last = r.boxes.find((b) => b.text === "Cliente HTTP do catálogo com novas tentativas")!;
    expect(last.top + last.height).toBeLessThan(r.height - 48);
  }, 30_000);

  it("títulos, nomes e frases enormes quebram linha sem passar da largura", async () => {
    const r = await layout(
      artifact({
        ...base,
        parou: [`PR 3 aberto (${LONGO}) e PR 1 aberto (${LONGO}): falta revisar e fechar os dois PRs antes da entrega`],
        travou: [`PR 10 aguarda revisão porque ${LONGO}`, `Bloqueado em ${BRANCH}`],
        tarefas: Array.from({ length: 6 }, (_, i) => ({ chave: `ECH-${100 + i}`, titulo: `${LONGO} (${i})`, estado: "em andamento" })),
        prs: Array.from({ length: 6 }, (_, i) => ({ numero: i + 1, titulo: LONGO, branch: `${BRANCH}-${i}`, rascunho: i % 2 === 0 })),
        atividade: [
          { tipo: "commits", label: "Commits enviados para branches de funcionalidades ainda em andamento", value: 123456 },
          { tipo: "prs", label: "PRs abertos ou mesclados", value: 2 },
          { tipo: "tarefas", label: "Tarefas concluídas", value: 7 },
        ],
        liberado: [{ branch: BRANCH, detail: LONGO }],
        reservado: [{ branch: BRANCH, detail: LONGO }],
      }),
    );
    expect(r.problems).toEqual([]);
    expect(r.boxes.some((b) => b.text === BRANCH)).toBe(true);
  }, 30_000);

  it("a altura cresce com o conteúdo", async () => {
    const short = await layout(artifact(base));
    const long = await layout(artifact({ ...base, travou: Array.from({ length: 10 }, (_, i) => `Pendência ${i}: ${LONGO}`) }));
    expect(long.problems).toEqual([]);
    expect(long.height).toBeGreaterThan(short.height + 600);
  }, 30_000);

  it("diz quantos itens ficaram de fora, em vez de esconder", async () => {
    const many = await layout(artifact({ ...base, travou: Array.from({ length: MAX_ITEMS_PER_BLOCK + 3 }, (_, i) => `Pendência ${i}`) }));
    expect(many.problems).toEqual([]);
    expect(many.boxes.map((b) => b.text)).toContain("+ 3 itens ficaram de fora desta imagem.");
    expect(many.boxes.map((b) => b.text)).toContain(String(MAX_ITEMS_PER_BLOCK + 3));

    // Tarefas além das que viram cartão (buildDayFacts guarda as primeiras) também são contadas.
    const tasks = await layout(artifact({ ...base, tarefas: Array.from({ length: 14 }, (_, i) => ({ chave: `ECH-${i}`, titulo: `Tarefa ${i}`, estado: "a fazer" })) }));
    expect(tasks.boxes.map((b) => b.text)).toContain("+ 8 itens ficaram de fora desta imagem.");
    expect(tasks.boxes.map((b) => b.text)).toContain("14");
  }, 30_000);
});
