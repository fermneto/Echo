// Imagem do resumo do dia (PNG) para a mensagem privada do Slack: o mesmo visual da página /resumos (tokens,
// rótulos fixos, cartões, números), montado em elementos do Satori (só flexbox) e convertido pelo resvg.
// Sem navegador: cabe no worker. Números, nomes e chaves vêm dos fatos; títulos e frases, da especificação validada.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Fact } from "@echo/artifacts";
import { Resvg } from "@resvg/resvg-js";
import satori, { type SatoriNode } from "satori";
import type { StoredArtifact } from "./day-summary.ts";

// Cores de apps/web/app/tokens.css
const C = {
  canvas: "#101010",
  panel: "#161616",
  edge: "#262626",
  line: "#212121",
  black: "#000000",
  chip: "#1a1a1a",
  cloud: "#fafafa",
  paper: "#e5e5e5",
  fog: "#a1a1a1",
  ash: "#808080",
  twin: "#4d8dff",
  twinDeep: "#1f5fe0",
  twinText: "#8db4ff",
  wait: "#e0b354",
  on: "#98ff38",
};

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
let fonts: { name: string; data: Buffer; weight: 400 | 500; style: "normal" }[] | null = null;
const loadFonts = () =>
  (fonts ??= [
    { name: "Inter", data: font("@fontsource/inter", "inter-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: "Inter", data: font("@fontsource/inter", "inter-latin-500-normal.woff"), weight: 500, style: "normal" },
    { name: "Geist", data: font("@fontsource/geist-sans", "geist-sans-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: "JetBrains Mono", data: font("@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff"), weight: 400, style: "normal" },
  ]);

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
const h = (style: Record<string, unknown>, ...children: unknown[]): Node => ({ type: "div", props: { style: { display: "flex", boxSizing: "border-box", ...style }, children: children.filter((c) => c !== null && c !== undefined && c !== false) } });
// Texto sempre quebra linha, inclusive palavra sem espaço (branch, chave, URL): nada sai da largura do cartão.
const text = (style: Record<string, unknown>, value: string): Node => ({ type: "div", props: { style: { display: "flex", boxSizing: "border-box", wordBreak: "break-word", ...style }, children: value } });

const WIDTH = 1200;
const PAD = 48;
const GAP = 16;
const BLOCK_PAD = 28;
/** Itens por bloco na imagem. O que passar disso aparece como "+ N itens", nunca some calado. */
export const MAX_ITEMS_PER_BLOCK = 12;
/** Altura máxima do PNG em pixels. Acima disso o zoom cai abaixo de 2x, mas a imagem inteira continua lá. */
const MAX_PNG_HEIGHT = 16_000;

const LABELS: Record<string, { label: string; color: string }> = {
  destaque: { label: "ONDE PAROU", color: C.twinText },
  lista_pendencias: { label: "O QUE TRAVOU", color: C.wait },
  cartao_tarefa: { label: "TAREFAS ABERTAS", color: C.paper },
  cartao_pr: { label: "PULL REQUESTS", color: C.paper },
  linha_do_dia: { label: "ATIVIDADE DO DIA", color: C.on },
  quadro_liberado_reservado: { label: "LIBERADO E RESERVADO", color: C.paper },
};
const HALF = new Set(["lista_pendencias", "linha_do_dia"]);

const tone = (status: string) => (status === "em revisão" || status === "aberto" ? C.twinText : status === "rascunho" || status === "a fazer" || status === "no backlog" ? C.wait : C.on);
const pill = (label: string, color: string) =>
  text({ fontFamily: "Inter", fontSize: 13, letterSpacing: 0.6, color, border: `1px solid ${color}`, borderRadius: 999, padding: "3px 10px", textTransform: "uppercase" }, label);

function head(component: string, title: string | undefined, sub: string | undefined, count?: number) {
  const l = LABELS[component] ?? { label: component.toUpperCase(), color: C.paper };
  return h(
    { flexDirection: "column", marginBottom: 18 },
    h(
      { alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
      h({ alignItems: "center" }, h({ width: 9, height: 9, borderRadius: 9, backgroundColor: l.color === C.paper ? C.fog : l.color, marginRight: 10 }), text({ fontFamily: "Inter", fontSize: 15, letterSpacing: 1, color: l.color }, l.label)),
      count !== undefined ? text({ fontFamily: "Inter", fontSize: 15, color: C.cloud, backgroundColor: C.chip, border: `1px solid ${C.edge}`, borderRadius: 999, padding: "2px 12px" }, String(count)) : null,
    ),
    title ? text({ fontFamily: "Geist", fontSize: 28, color: C.cloud, lineHeight: 1.2 }, title) : null,
    sub ? text({ fontFamily: "Inter", fontSize: 17, color: C.fog, marginTop: 4 }, sub) : null,
  );
}

function blockBox(half: boolean, children: Node[], accent?: "twin" | "wait") {
  return h(
    {
      flexDirection: "column",
      ...(half ? { flexGrow: 1, flexBasis: 0 } : { width: "100%" }),
      padding: accent === "twin" ? 36 : BLOCK_PAD,
      backgroundColor: accent === "twin" ? "#152038" : C.panel,
      border: `1px solid ${accent === "twin" ? "#2f5fb3" : accent === "wait" ? "#7a6431" : C.edge}`,
      borderRadius: 10,
    },
    ...children,
  );
}

// Larguras em percentual do bloco: o Satori soma padding e borda às larguras fixas.
const col3 = (i: number, gap = "2%") => ({ width: "32%", marginRight: (i + 1) % 3 ? gap : 0 });

function body(component: string, facts: Fact[]): Node {
  switch (component) {
    case "destaque":
      return h({ flexDirection: "column" }, ...facts.map((f) => text({ fontFamily: "Geist", fontSize: 34, color: C.cloud, lineHeight: 1.25, marginBottom: 8 }, f.label)));
    case "lista_pendencias":
      return h({ flexDirection: "column" }, ...facts.map((f) => text({ fontFamily: "Inter", fontSize: 19, color: C.cloud, backgroundColor: C.black, border: `1px solid ${C.line}`, borderLeft: `4px solid ${C.wait}`, borderRadius: 6, padding: "14px 18px", marginBottom: 10 }, f.label)));
    case "linha_do_dia": {
      const w = facts.length >= 3 ? "32%" : facts.length === 2 ? "49%" : "49%";
      return h(
        { flexWrap: "wrap" },
        ...facts.map((f, i) =>
          h(
            { flexDirection: "column", width: w, marginRight: facts.length >= 3 ? ((i + 1) % 3 ? "2%" : 0) : i % 2 ? 0 : "2%", marginBottom: 10, padding: "14px 18px", backgroundColor: C.black, border: `1px solid ${C.line}`, borderRadius: 6 },
            text({ fontFamily: "Geist", fontSize: 52, color: C.cloud, lineHeight: 1.05 }, String(f.value ?? "—")),
            text({ fontFamily: "Inter", fontSize: 14, letterSpacing: 0.6, color: C.fog, textTransform: "uppercase", marginTop: 6 }, f.label),
          ),
        ),
      );
    }
    case "cartao_tarefa":
    case "cartao_pr": {
      return h(
        { flexWrap: "wrap" },
        ...facts.map((f, i) =>
          h(
            { flexDirection: "column", ...col3(i), marginBottom: 12, padding: 18, backgroundColor: C.black, border: `1px solid ${C.line}`, borderRadius: 6 },
            h({ alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }, text({ fontFamily: "JetBrains Mono", fontSize: 15, color: C.fog, flexShrink: 1, marginRight: 8 }, f.detail ?? ""), f.status ? h({ flexShrink: 0 }, pill(f.status, tone(f.status))) : null),
            text({ fontFamily: "Inter", fontSize: 20, color: C.cloud, lineHeight: 1.35 }, f.label),
          ),
        ),
      );
    }
    case "quadro_liberado_reservado": {
      const col = (kind: Fact["kind"], label: string) => {
        const items = facts.filter((f) => f.kind === kind);
        return h(
          { flexDirection: "column", width: "49%" },
          text({ fontFamily: "Inter", fontSize: 14, letterSpacing: 1, color: C.fog, marginBottom: 10 }, label),
          ...(items.length
            ? items.map((f) =>
                h(
                  { flexDirection: "column", padding: "14px 18px", backgroundColor: C.black, border: `1px solid ${C.line}`, borderRadius: 6, marginBottom: 8 },
                  text({ fontFamily: "JetBrains Mono", fontSize: 17, color: C.cloud }, f.label),
                  f.detail ? text({ fontFamily: "Inter", fontSize: 16, color: C.fog, marginTop: 4 }, f.detail) : null,
                ),
              )
            : [text({ fontFamily: "Inter", fontSize: 16, color: C.ash, padding: "14px 18px", border: `1px dashed ${C.edge}`, borderRadius: 6 }, "Nada declarado.")]),
        );
      };
      return h({ flexDirection: "column" }, h({ justifyContent: "space-between" }, col("liberado", "LIBERADO"), col("reservado", "RESERVADO")), text({ fontFamily: "Inter", fontSize: 14, color: C.ash, marginTop: 10 }, "Só a própria pessoa declara o que está liberado ou reservado."));
    }
    default:
      return h({}, ...facts.map((f) => text({ fontFamily: "Inter", fontSize: 18, color: C.cloud }, f.label)));
  }
}

const modelName = (tag: string) => (tag.startsWith("qwen3:4b") ? "Qwen3 4B" : tag.startsWith("qwen2.5-coder:1.5b") ? "Qwen2.5-Coder 1.5B" : tag);

/** Monta o SVG do resumo. A altura sai do conteúdo (o Satori mede o texto com as fontes embutidas), nunca de uma estimativa. */
export async function renderSummarySvg(a: StoredArtifact, opts: { stateLabel?: string; onNode?: (n: SatoriNode) => void } = {}): Promise<{ svg: string; width: number; height: number }> {
  const byId = new Map(a.facts.facts.map((f) => [f.id, f]));
  const dd = `${a.facts.date.slice(8, 10)}/${a.facts.date.slice(5, 7)}`;
  const by = a.state === "rendered" && a.model ? `Layout por ${modelName(a.model)} · modelo aberto` : "Layout padrão, por regra";

  const rows: Node[] = [];
  const blocks = a.spec.blocks.map((b) => ({ ...b, facts: b.factIds.map((id) => byId.get(id)).filter((f): f is Fact => !!f) })).filter((b) => b.facts.length);
  const make = (b: (typeof blocks)[number], half: boolean) => {
    const shown = b.facts.slice(0, MAX_ITEMS_PER_BLOCK);
    // Cartões que já ficaram de fora dos fatos (buildDayFacts guarda só os primeiros) também entram na conta.
    const upstream = b.component === "cartao_tarefa" ? (a.facts.omitted?.tarefa ?? 0) : b.component === "cartao_pr" ? (a.facts.omitted?.pr ?? 0) : 0;
    const left = b.facts.length - shown.length + upstream;
    return blockBox(
      half,
      [
        head(b.component, b.title, b.text, b.component === "lista_pendencias" || b.component.startsWith("cartao_") ? b.facts.length + upstream : undefined),
        body(b.component, shown),
        left > 0 ? text({ fontFamily: "Inter", fontSize: 16, color: C.wait, marginTop: 6 }, `+ ${left} ${left === 1 ? "item ficou" : "itens ficaram"} de fora desta imagem.`) : null,
      ].filter((n): n is Node => !!n),
      b.component === "destaque" ? "twin" : b.component === "lista_pendencias" ? "wait" : undefined,
    );
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const next = blocks[i + 1];
    if (HALF.has(b.component) && next && HALF.has(next.component)) {
      rows.push(h({ width: "100%", alignItems: "stretch", marginBottom: GAP }, make(b, true), h({ width: GAP, flexShrink: 0 }), make(next, true)));
      i++;
    } else rows.push(h({ width: "100%", marginBottom: GAP }, make(b, false)));
  }

  // Sem altura fixa: a raiz cresce com o conteúdo e o canvas acompanha.
  const tree = h(
    { flexDirection: "column", width: "100%", padding: PAD, backgroundColor: C.canvas },
    h(
      { alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 14 },
      text({ fontFamily: "Geist", fontSize: 52, color: C.cloud, letterSpacing: -1, marginRight: 16 }, `Resumo do dia, ${dd}`),
      h(
        { alignItems: "center", marginBottom: 12 },
        opts.stateLabel ? h({ marginRight: 10 }, pill(opts.stateLabel, C.wait)) : null,
        text({ fontFamily: "Inter", fontSize: 14, color: a.state === "rendered" ? C.twinText : C.fog, border: `1px solid ${a.state === "rendered" ? "#2f5fb3" : C.edge}`, backgroundColor: a.state === "rendered" ? "#111a2c" : C.chip, borderRadius: 999, padding: "5px 12px" }, by),
      ),
    ),
    text({ fontFamily: "Inter", fontSize: 19, color: C.fog, marginBottom: 28, lineHeight: 1.45 }, `Feito pelo Agente de ${a.facts.pessoa} a partir do GitHub, do Linear e da sua nota. Números e nomes vêm dos fatos, nunca do modelo.`),
    ...rows,
  );

  const svg = await satori(tree as never, { width: WIDTH, fonts: loadFonts(), ...(opts.onNode ? { onNodeDetected: opts.onNode } : {}) });
  const height = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1]);
  if (!Number.isFinite(height) || height <= 0) throw new Error("SVG do resumo sem altura");
  return { svg, width: WIDTH, height };
}

/** PNG do resumo (2x para ficar nítido no Slack). Lança se o render falhar; quem chama manda a versão em texto. */
export async function renderSummaryPng(a: StoredArtifact, opts: { stateLabel?: string } = {}): Promise<Buffer> {
  const { svg, height } = await renderSummarySvg(a, opts);
  const zoom = Math.min(2, MAX_PNG_HEIGHT / height);
  const png = new Resvg(svg, { fitTo: { mode: "zoom", value: zoom }, background: C.canvas }).render().asPng();
  return Buffer.from(png);
}
