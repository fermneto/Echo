// Resumos interativos (etapa 26): biblioteca FECHADA de componentes + especificação que o modelo devolve.
// As regras calculam os fatos (cada um com id). O modelo só escolhe componentes, ordem e textos curtos, e
// referencia fatos pelo id. Números, datas e nomes entram pelo código a partir dos fatos. O validador recusa
// texto com número ou em primeira pessoa, id desconhecido ou fato no componente errado; fato que o modelo
// deixou de fora entra no fim, por regra (o modelo arruma e redige, mas não esconde nada). Sem especificação
// válida, vale o layout padrão.
import { z } from "zod";

export const COMPONENTS = ["destaque", "linha_do_dia", "cartao_tarefa", "cartao_pr", "lista_ordenavel", "quadro_liberado_reservado", "mapa_fusos", "barra_carga", "lista_pendencias"] as const;
export type Component = (typeof COMPONENTS)[number];

/** Textos curtos sem números; números, datas e nomes entram pelo código via `factIds`. */
export const artifactSpecSchema = z.object({
  kind: z.enum(["nota", "plano", "resumo"]),
  blocks: z
    .array(
      z.object({
        component: z.enum(COMPONENTS),
        title: z.string().max(80).optional(),
        text: z.string().max(280).optional(),
        factIds: z.array(z.string()).default([]),
      }),
    )
    .max(12),
});
export type ArtifactSpec = z.infer<typeof artifactSpecSchema>;
export type ArtifactBlock = ArtifactSpec["blocks"][number];

// ---------- Fatos do resumo do dia

export type FactKind = "parou" | "travou" | "atividade" | "tarefa" | "pr" | "liberado" | "reservado";

/** Um fato calculado por regra. `label`, `detail`, `value` e `status` vêm do código e podem ter números e nomes. */
export interface Fact {
  id: string;
  kind: FactKind;
  label: string;
  detail?: string;
  /** Valor de um contador (atividade), mostrado pelo código. */
  value?: number;
  /** Estado curto para o selo do cartão (ex.: "em revisão", "rascunho"). */
  status?: string;
}

export interface DayFacts {
  pessoa: string;
  /** AAAA-MM-DD no fuso da pessoa. */
  date: string;
  facts: Fact[];
}

/** Que fatos cada componente da nota aceita. */
export const NOTE_COMPONENTS: Partial<Record<Component, readonly FactKind[]>> = {
  destaque: ["parou"],
  lista_pendencias: ["travou"],
  linha_do_dia: ["atividade"],
  cartao_tarefa: ["tarefa"],
  cartao_pr: ["pr"],
  quadro_liberado_reservado: ["liberado", "reservado"],
};

/** Ordem e títulos do layout padrão (também usados para completar fatos que ficaram de fora). */
const DEFAULT_ORDER: { component: Component; title: string }[] = [
  { component: "destaque", title: "Onde parou" },
  { component: "lista_pendencias", title: "O que travou" },
  { component: "cartao_tarefa", title: "Tarefas abertas" },
  { component: "cartao_pr", title: "Pull requests abertos" },
  { component: "linha_do_dia", title: "Atividade do dia" },
  { component: "quadro_liberado_reservado", title: "Liberado e reservado" },
];

const componentFor = (kind: FactKind): Component => Object.entries(NOTE_COMPONENTS).find(([, kinds]) => kinds!.includes(kind))![0] as Component;

/** Layout por regra: um bloco por componente com fatos, na ordem padrão. */
export function defaultSpec(day: DayFacts): ArtifactSpec {
  const blocks: ArtifactBlock[] = [];
  for (const d of DEFAULT_ORDER) {
    const ids = day.facts.filter((f) => componentFor(f.kind) === d.component).map((f) => f.id);
    if (ids.length) blocks.push({ component: d.component, title: d.title, factIds: ids });
  }
  return { kind: "nota", blocks };
}

// ---------- Validação

const FIRST_PERSON = /(?<!\p{L})(eu|me|mim|comigo|meu|minha|meus|minhas|fiz|estou|estava|trabalhei|terminei|parei|vou|preciso|consegui)(?!\p{L})/iu;
const JUDGEMENT = /(?<!\p{L})(produtiv[oa]|improdutiv[oa]|pregui[çc]os[oa]|excelente|p[ée]ssim[oa]|ranking|desempenho|aprovad[oa]|lgtm)(?!\p{L})/iu;
const LINK_OR_MARKUP = /(https?:\/\/|www\.|<[a-z/]|`|\*\*|@\w)/i;

/** Problemas de um texto do modelo (título ou frase). */
export function textIssues(text: string): string[] {
  const issues: string[] = [];
  if (/\d/.test(text)) issues.push("número no texto");
  if (FIRST_PERSON.test(text)) issues.push("primeira pessoa");
  if (JUDGEMENT.test(text)) issues.push("avaliação da pessoa");
  if (LINK_OR_MARKUP.test(text)) issues.push("link, menção ou marcação");
  return issues;
}

export interface SpecCheck {
  spec: ArtifactSpec;
  /** Problemas encontrados. */
  issues: string[];
  /** False: a especificação do modelo foi recusada e vale o layout padrão. */
  usedModel: boolean;
}

const clean = (s: string | undefined, max: number) => {
  const t = s?.replace(/\s+/g, " ").trim().slice(0, max);
  return t ? t : undefined;
};

// Na entrada, o tamanho é cortado (não recusado); o resto do formato é conferido.
const modelSpecSchema = z.object({
  kind: z.literal("nota"),
  blocks: z.array(z.object({ component: z.enum(COMPONENTS), title: z.string().optional(), text: z.string().optional(), factIds: z.array(z.string()).default([]) })).max(12),
});

/**
 * Valida a especificação do modelo contra os fatos. Título ou frase com problema (número, primeira pessoa,
 * avaliação, markup) caem: o título vira o padrão do componente e a frase some. Id desconhecido, fato no
 * componente errado ou repetido saem do bloco (bloco vazio some, com o título dele) e o fato volta por regra,
 * no componente certo. Formato errado ou nenhum bloco aproveitável: vale o padrão. Nenhum fato some.
 */
export function checkSpec(raw: unknown, day: DayFacts): SpecCheck {
  const fallback = (issues: string[]): SpecCheck => ({ spec: defaultSpec(day), issues, usedModel: false });
  const parsed = modelSpecSchema.safeParse(raw);
  if (!parsed.success) return fallback(["fora do formato"]);
  const byId = new Map(day.facts.map((f) => [f.id, f]));
  const used = new Set<string>();
  const issues: string[] = [];
  const dropped: string[] = [];
  const blocks: ArtifactBlock[] = [];
  for (const b of parsed.data.blocks) {
    const accepts = NOTE_COMPONENTS[b.component];
    if (!accepts) {
      issues.push(`componente fora da nota: ${b.component}`);
      continue;
    }
    const ids: string[] = [];
    for (const id of b.factIds) {
      const f = byId.get(id);
      if (!f) dropped.push(`fato desconhecido: ${id}`);
      else if (!accepts.includes(f.kind)) dropped.push(`fato no componente errado: ${id}`);
      else if (used.has(id)) dropped.push(`fato repetido: ${id}`);
      else {
        used.add(id);
        ids.push(id);
      }
    }
    if (!ids.length) continue;
    const titleIssues = b.title ? textIssues(b.title) : [];
    const textProblems = b.text ? textIssues(b.text) : [];
    if (titleIssues.length) dropped.push(`título trocado (${titleIssues.join(", ")})`);
    if (textProblems.length) dropped.push(`frase retirada (${textProblems.join(", ")})`);
    const title = titleIssues.length ? DEFAULT_ORDER.find((d) => d.component === b.component)?.title : clean(b.title, 80);
    const text = textProblems.length ? undefined : clean(b.text, 280);
    blocks.push({ component: b.component, ...(title ? { title } : {}), ...(text ? { text } : {}), factIds: ids });
  }
  if (issues.length) return fallback([...new Set(issues)]);
  if (!blocks.length) return fallback([...new Set(dropped), "sem blocos"]);

  // Um bloco por componente: o modelo pequeno às vezes abre um bloco para cada cartão. Juntos, o título de um
  // cartão não descreve o grupo: o bloco fica só com o rótulo fixo do componente.
  for (let i = blocks.length - 1; i > 0; i--) {
    const first = blocks.findIndex((b) => b.component === blocks[i]!.component);
    if (first < i) {
      const keep = blocks[first]!;
      blocks[first] = { component: keep.component, factIds: [...keep.factIds, ...blocks[i]!.factIds] };
      blocks.splice(i, 1);
    }
  }

  // Completa o que o modelo deixou de fora, na ordem padrão.
  const missing = day.facts.filter((f) => !used.has(f.id));
  for (const d of DEFAULT_ORDER) {
    const ids = missing.filter((f) => componentFor(f.kind) === d.component).map((f) => f.id);
    if (!ids.length) continue;
    const same = blocks.find((b) => b.component === d.component);
    if (same) same.factIds.push(...ids);
    else blocks.push({ component: d.component, title: d.title, factIds: ids });
  }
  const notes = [...new Set(dropped), ...(missing.length ? [`completado por regra: ${missing.map((f) => f.id).join(", ")}`] : [])];
  return { spec: { kind: "nota", blocks: blocks.slice(0, 12) }, issues: notes, usedModel: true };
}

/**
 * Especificação gravada, conferida de novo na leitura contra os fatos atuais. Ids que sumiram caem; fatos novos
 * entram por regra. Nunca lança.
 */
export function specForRender(stored: unknown, day: DayFacts): ArtifactSpec {
  const parsed = artifactSpecSchema.safeParse(stored);
  if (!parsed.success) return defaultSpec(day);
  const known = new Set(day.facts.map((f) => f.id));
  const blocks = parsed.data.blocks.map((b) => ({ ...b, factIds: b.factIds.filter((id) => known.has(id)) })).filter((b) => b.factIds.length);
  const check = checkSpec({ kind: "nota", blocks }, day);
  return check.spec;
}

/** Esquema JSON para a saída restrita do modelo: só componentes da nota e só ids que existem. */
export function noteSpecJsonSchema(day: DayFacts) {
  const ids = day.facts.map((f) => f.id);
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["nota"] },
      blocks: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            component: { type: "string", enum: Object.keys(NOTE_COMPONENTS) },
            title: { type: "string", maxLength: 60 },
            text: { type: "string", maxLength: 160 },
            factIds: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", enum: ids.length ? ids : ["nenhum"] } },
          },
          required: ["component", "title", "factIds"],
          additionalProperties: false,
        },
      },
    },
    required: ["kind", "blocks"],
    additionalProperties: false,
  };
}

/** Formato da resposta, descrito no texto do pedido (o modelo pequeno se perde com o esquema restrito aninhado). */
export const NOTE_SPEC_FORMAT = `{"kind": "nota", "blocks": [{"component": "<componente>", "title": "<até seis palavras>", "text": "<frase curta, opcional>", "factIds": ["<id do fato, ex.: f1>"]}]}`;

/** Componentes aceitos e o tipo de fato de cada um, em texto para o pedido. */
export const NOTE_COMPONENTS_TEXT = Object.entries(NOTE_COMPONENTS)
  .map(([c, kinds]) => `- ${c}: só fatos do tipo ${kinds!.join(" ou ")}`)
  .join("\n");

/**
 * Texto do fato sem números, chaves e datas: o modelo não vê o que não pode escrever ("ECH-128, PR 44 aberto:
 * falta tratar o erro" → "PR aberto: falta tratar o erro"). O painel mostra o fato inteiro, a partir do código.
 */
export function withoutNumbers(s: string): string {
  return s
    .replace(/\([^)]*\d[^)]*\)/g, " ")
    .replace(/[\p{L}\d._/#-]*\d[\p{L}\d._/#-]*/gu, " ")
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/^[\s,;:.]+/, "")
    .replace(/([,;:])(?=[,;:])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Id curto que o modelo usa para cada fato ("f1", "f2"...): o modelo pequeno se perde com ids longos. */
const shortId = (i: number) => `f${i + 1}`;

/** O que o modelo recebe: fatos com id curto, tipo e texto sem números (como dado). */
export function factsForModel(day: DayFacts) {
  return { fatos: day.facts.map((f, i) => ({ id: shortId(i), tipo: f.kind, texto: withoutNumbers(f.label), ...(f.status ? { estado: f.status } : {}) })) };
}

/** Troca os ids curtos da resposta do modelo pelos ids dos fatos. Id que não existe fica como veio (o validador tira). */
export function fromModelIds(raw: unknown, day: DayFacts): unknown {
  const map = new Map(day.facts.map((f, i) => [shortId(i), f.id]));
  const r = raw as { blocks?: unknown };
  if (!r || typeof r !== "object" || !Array.isArray(r.blocks)) return raw;
  return { ...r, blocks: r.blocks.map((b: { factIds?: unknown }) => (b && Array.isArray(b.factIds) ? { ...b, factIds: b.factIds.map((id) => (typeof id === "string" ? (map.get(id) ?? id) : id)) } : b)) };
}

// ---------- Montagem dos fatos (código)

export interface DayInput {
  pessoa: string;
  date: string;
  parou: string[];
  travou: string[];
  tarefas?: { chave: string; titulo: string; estado: string }[];
  prs?: { numero: number; titulo: string; branch: string; rascunho: boolean }[];
  /** Contadores do dia, já agrupados por regra. */
  atividade?: { tipo: string; label: string; value: number }[];
  liberado: { branch: string; detail?: string }[];
  reservado: { branch: string; detail?: string }[];
}

const MAX_CARDS = 6;
const trimEnd = (s: string) => s.trim().replace(/[.;]+$/, "");

/** Fatos com ids estáveis: o mesmo item gera o mesmo id no fim do expediente e na leitura do painel. */
export function buildDayFacts(input: DayInput): DayFacts {
  const facts: Fact[] = [];
  input.parou.map(trimEnd).filter(Boolean).forEach((label, i) => facts.push({ id: `parou:${i}`, kind: "parou", label }));
  input.travou.map(trimEnd).filter(Boolean).forEach((label, i) => facts.push({ id: `travou:${i}`, kind: "travou", label }));
  for (const t of (input.tarefas ?? []).slice(0, MAX_CARDS)) facts.push({ id: `tarefa:${t.chave}`, kind: "tarefa", label: t.titulo, detail: t.chave, status: t.estado });
  for (const p of (input.prs ?? []).slice(0, MAX_CARDS)) facts.push({ id: `pr:${p.numero}`, kind: "pr", label: p.titulo, detail: `PR ${p.numero} · ${p.branch}`, status: p.rascunho ? "rascunho" : "aberto" });
  for (const a of input.atividade ?? []) if (a.value > 0) facts.push({ id: `atividade:${a.tipo}`, kind: "atividade", label: a.label, value: a.value });
  for (const m of input.liberado) facts.push({ id: `liberado:${m.branch}`, kind: "liberado", label: m.branch, ...(m.detail ? { detail: m.detail } : {}) });
  for (const m of input.reservado) facts.push({ id: `reservado:${m.branch}`, kind: "reservado", label: m.branch, ...(m.detail ? { detail: m.detail } : {}) });
  return { pessoa: input.pessoa, date: input.date, facts };
}
