// Vídeo da semana da equipe: regras puras. O que entra em cada cena, quanto tempo cada uma dura, quais números
// podem aparecer e o que o texto não pode dizer. Os números saem dos relatórios conferidos (regras); o modelo
// só escreve frases curtas. Sem nota, sem ranking, sem comparar pessoas: a semana é da equipe.
import type { AvatarTraits } from "./avatar.ts";

export const TEAM_VIDEO_RULES = {
  maxSeconds: 90,
  maxDeliveries: 6,
  maxHelps: 5,
  maxClips: 3,
  /** Segundos de um trecho de tela dentro do vídeo. */
  clipSeconds: 10,
  maxTextChars: 90,
  /** Dias até o vídeo sair do armazenamento. */
  retentionDays: 30,
} as const;

export interface TeamWeekFacts {
  teamName: string;
  /** "2 a 6/11" */
  weekLabel: string;
  people: { id: string; name: string; avatar: AvatarTraits }[];
  deliveries: { ref: string; title: string; personId: string }[];
  /** Quem ajudou quem, já confirmado nos relatórios (crédito, nunca placar). */
  helps: { fromId: string; toId: string; count: number }[];
  /** Perguntas que o gêmeo respondeu com a pessoa fora, e de quem eram os gêmeos. */
  twins: { answered: number; peopleIds: string[] };
  /** Trechos de tela gravados no preview (arquivo dentro do ambiente de gravação). */
  clips: { ref: string; title: string; file: string }[];
}

export interface TeamWeekTexts {
  opening: string;
  deliveries: string;
  helps: string;
  twins: string;
  closing: string;
}

export type SceneKind = "opening" | "numbers" | "deliveries" | "clip" | "helps" | "twins" | "closing";
export interface Scene {
  kind: SceneKind;
  /** Início em segundos. */
  at: number;
  seconds: number;
  /** Nome curto da cena (capítulos no painel). */
  title: string;
  /** O que a voz diz nesta cena: o texto conferido, ou frase por regra (números e telas novas). */
  narration: string;
  /** Para "clip": qual trecho. */
  clip?: number;
}

/** Frase falada da cena de números: só os totais da equipe, por regra. */
export function numbersNarration(f: TeamWeekFacts): string {
  const t = teamTotals(f);
  const parts = [
    t.deliveries ? `${t.deliveries} ${t.deliveries === 1 ? "entrega" : "entregas"}` : "",
    t.helps ? `${t.helps} ${t.helps === 1 ? "ajuda entre colegas" : "ajudas entre colegas"}` : "",
    t.answered ? `${t.answered} ${t.answered === 1 ? "resposta dos gêmeos" : "respostas dos gêmeos"}` : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : parts[0];
  return `Nesta semana, foram ${list}.`;
}

/** Números que a semana mostra: totais da equipe, nunca por pessoa. */
export function teamTotals(f: TeamWeekFacts): { deliveries: number; helps: number; answered: number } {
  return { deliveries: f.deliveries.length, helps: f.helps.reduce((s, h) => s + h.count, 0), answered: f.twins.answered };
}

/** Corta o que não cabe em 90 s e devolve as cenas com início e duração. Cena sem conteúdo fica de fora. */
export function planScenes(f: TeamWeekFacts, texts: TeamWeekTexts): { facts: TeamWeekFacts; scenes: Scene[] } {
  const R = TEAM_VIDEO_RULES;
  const facts: TeamWeekFacts = {
    ...f,
    deliveries: f.deliveries.slice(0, R.maxDeliveries),
    helps: f.helps.slice(0, R.maxHelps),
    clips: f.clips.slice(0, R.maxClips),
  };
  const plan: Omit<Scene, "at">[] = [{ kind: "opening", seconds: 5, title: "Abertura", narration: texts.opening }];
  const t = teamTotals(f);
  if (t.deliveries + t.helps + t.answered > 0) plan.push({ kind: "numbers", seconds: 6, title: "A semana em números", narration: numbersNarration(f) });
  if (facts.deliveries.length) plan.push({ kind: "deliveries", seconds: 3 + 1.4 * facts.deliveries.length, title: "Entregas", narration: texts.deliveries });
  facts.clips.forEach((c, i) => plan.push({ kind: "clip", seconds: R.clipSeconds, title: c.title, narration: `Uma das telas novas: ${c.title}.`, clip: i }));
  if (facts.helps.length) plan.push({ kind: "helps", seconds: 3.5 + 1.6 * facts.helps.length, title: "Ajudas entre colegas", narration: texts.helps });
  if (facts.twins.answered > 0) plan.push({ kind: "twins", seconds: 7, title: "Gêmeos em ação", narration: texts.twins });
  plan.push({ kind: "closing", seconds: 4.5, title: "Encerramento", narration: texts.closing });
  // Passou de 90 s: tira trechos de tela do fim até caber.
  while (plan.reduce((s, p) => s + p.seconds, 0) > R.maxSeconds && plan.some((p) => p.kind === "clip")) {
    const i = plan.map((p) => p.kind).lastIndexOf("clip");
    plan.splice(i, 1);
    facts.clips = facts.clips.slice(0, -1);
  }
  let at = 0;
  const scenes = plan.map((p) => {
    const s = { ...p, at: Math.round(at * 10) / 10 };
    at += p.seconds;
    return s;
  });
  return { facts, scenes };
}

export function scenesSeconds(scenes: readonly Scene[]): number {
  const last = scenes.at(-1);
  return last ? last.at + last.seconds : 0;
}

const RANKING = /\b(melhor(es)?|pior(es)?|mais produtiv\w*|menos produtiv\w*|destaque\w*|campe[ãa]o|campeã|ranking|top \d|vencedor\w*|nota|primeiro lugar|quem mais|recordista|mvp)\b/i;
const FIRST_PERSON = /\b(eu|meu|minha|nós|nosso|nossa)\b/i;
const DIGITS = /\d+([.,]\d+)?/g;

/**
 * Confere os textos do modelo: curtos, em terceira pessoa, sem ranking e sem número além dos totais da equipe,
 * dos identificadores das entregas e das datas da semana.
 */
export function teamTextIssues(raw: unknown, f: TeamWeekFacts): string[] {
  const issues: string[] = [];
  const t = raw && typeof raw === "object" ? (raw as Partial<Record<keyof TeamWeekTexts, unknown>>) : {};
  const totals = teamTotals(f);
  const allowed = new Set([String(totals.deliveries), String(totals.helps), String(totals.answered), ...[f.weekLabel, ...f.deliveries.map((d) => d.ref)].flatMap((s) => s.match(DIGITS) ?? [])]);
  for (const k of ["opening", "deliveries", "helps", "twins", "closing"] as const) {
    const v = t[k];
    if (typeof v !== "string" || !v.trim()) {
      issues.push(`${k}: vazio`);
      continue;
    }
    if (v.length > TEAM_VIDEO_RULES.maxTextChars) issues.push(`${k}: longo demais`);
    if (RANKING.test(v)) issues.push(`${k}: compara ou classifica pessoas`);
    if (FIRST_PERSON.test(v)) issues.push(`${k}: primeira pessoa`);
    const stray = (v.match(DIGITS) ?? []).filter((d) => !allowed.has(d));
    if (stray.length) issues.push(`${k}: número fora dos totais (${stray.join(", ")})`);
  }
  return issues;
}

/** Textos por regra, quando não há modelo ou o modelo errou: neutros, sem ranking e só com os totais. */
export function ruleTeamTexts(f: TeamWeekFacts): TeamWeekTexts {
  const t = teamTotals(f);
  return {
    opening: `A semana da equipe ${f.teamName}`,
    deliveries: t.deliveries === 1 ? "Uma entrega chegou ao fim" : `${t.deliveries} entregas chegaram ao fim`,
    helps: t.helps === 1 ? "Uma ajuda entre colegas destravou o trabalho" : `${t.helps} ajudas entre colegas destravaram o trabalho`,
    twins: t.answered === 1 ? "Os gêmeos responderam uma pergunta com a equipe fora" : `Os gêmeos responderam ${t.answered} perguntas com a equipe fora`,
    closing: "Bom fim de semana",
  };
}

/**
 * Confere a gravação do vídeo da semana fora do ambiente: a duração lida do mp4 bate com as cenas planejadas
 * (com folga para o carregamento) e o navegador só abriu os previews dos trechos ou a própria página local.
 */
export function teamRecordingIssues(raw: unknown, ctx: { previewHosts: readonly string[]; plannedSeconds: number; mp4DurationS: number | null }): string[] {
  const issues: string[] = [];
  const m = raw && typeof raw === "object" ? (raw as { visited?: unknown }) : {};
  const d = ctx.mp4DurationS;
  if (d === null) issues.push("mp4 sem duração legível");
  else if (d > TEAM_VIDEO_RULES.maxSeconds + 8) issues.push(`duração fora do limite (${Math.round(d)} s)`);
  else if (d < ctx.plannedSeconds - 3) issues.push(`vídeo mais curto que as cenas (${Math.round(d)} s de ${Math.round(ctx.plannedSeconds)} s)`);
  if (!Array.isArray(m.visited)) issues.push("sem lista de endereços visitados");
  else
    for (const u of m.visited) {
      let ok = false;
      try {
        const url = new URL(String(u));
        ok = url.protocol === "file:" || url.protocol === "about:" || (url.protocol === "https:" && ctx.previewHosts.includes(url.hostname)) || url.hostname === "localhost" || url.hostname === "127.0.0.1";
      } catch {
        ok = false;
      }
      if (!ok) {
        issues.push("o navegador saiu do preview");
        break;
      }
    }
  return issues;
}

/** Folga depois de cada fala, para a cena não cortar a voz. */
export const NARRATION_PAD_S = 0.9;

/**
 * Tempos finais das cenas depois de sintetizar a voz: cada cena dura o planejado ou a fala mais a folga, o que for
 * maior. O executor faz a mesma conta dentro do ambiente; esta é a referência testada.
 */
export function stretchScenes(scenes: readonly Scene[], voiceSeconds: readonly (number | null)[]): Scene[] {
  let at = 0;
  return scenes.map((s, i) => {
    const v = voiceSeconds[i];
    const seconds = Math.max(s.seconds, v ? Math.round((v + NARRATION_PAD_S) * 10) / 10 : 0);
    const out = { ...s, at: Math.round(at * 10) / 10, seconds };
    at += seconds;
    return out;
  });
}
