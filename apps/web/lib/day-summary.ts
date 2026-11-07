import { type ArtifactSpec, buildDayFacts, type DayFacts, defaultSpec, specForRender } from "@echo/artifacts";
import { personIdFor } from "./agent";
import type { NoteView } from "./daily-note";
import { readNote } from "./daily-note-store";
import { panelDb } from "./db";
import type { Persona } from "./demo/types";
import { gainsOrgId } from "./gains";

/**
 * Resumo do dia (etapa 26) da própria pessoa. Com banco, a especificação e os fatos gravados pelo worker
 * (modelo aberto ou layout padrão), conferidos de novo contra os fatos. Sem resumo gravado (demonstração ou
 * worker sem Ollama), layout padrão por regra a partir da nota do dia.
 */
export type DaySummaryView = { date: string; day: DayFacts; spec: ArtifactSpec; model?: string; note: NoteView | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Fatos a partir da nota da tela (sem tarefas, PRs e atividade, que só o worker conhece). */
export function factsFromNote(view: NoteView, pessoa: string): DayFacts {
  const s = view.sections;
  return buildDayFacts({
    pessoa,
    date: view.date,
    parou: s.stoppedAt,
    travou: s.blocked,
    liberado: s.released.map((l) => ({ branch: l })),
    reservado: s.reserved.map((l) => ({ branch: l })),
  });
}

export async function readDaySummary(me: Persona, date?: string): Promise<DaySummaryView | null> {
  const first = me.name.split(/\s+/)[0] ?? me.name;
  const { view } = await readNote(me);
  const target = date && ISO_DAY.test(date) ? date : view?.date;
  if (!target) return null;

  const db = panelDb();
  if (db) {
    const { createPgArtifactStore } = await import("@echo/agents/server");
    const stored = await createPgArtifactStore(db, gainsOrgId(me.orgId)).get(personIdFor(me.id), target);
    if (stored) return { date: target, day: stored.facts, spec: specForRender(stored.spec, stored.facts), ...(stored.state === "rendered" && stored.model ? { model: stored.model } : {}), note: view?.date === target ? view : null };
  }
  if (!view || view.date !== target) return null;
  const day = factsFromNote(view, first);
  return { date: target, day, spec: defaultSpec(day), note: view };
}
