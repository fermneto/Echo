import { personIdFor } from "./agent";
import { awayRows, demoAwayRows, lastWorkEnd, type AwayRow } from "./away-log";
import { panelDb } from "./db";
import { NIGHT_LOG } from "./demo/feed";
import type { Persona } from "./demo/types";
import { gainsOrgId } from "./gains";

/**
 * Linhas de "Enquanto você estava fora" para quem abriu o Início. Com banco, perguntas, correções e plano da
 * manhã gravados desde o fim do último expediente; sem banco, o registro da noite da demonstração.
 * Falha na leitura vira lista vazia com aviso no log, nunca dado inventado.
 */
export async function loadAwayRows(me: Pick<Persona, "id" | "orgId" | "timezone" | "workHours">, now: Date): Promise<{ rows: AwayRow[]; since: Date | null }> {
  const db = panelDb();
  if (!db) return { rows: demoAwayRows(me.id, me.timezone, NIGHT_LOG), since: null };
  const since = lastWorkEnd(me, now);
  try {
    const { readAwayLog } = await import("@echo/agents/enquanto-fora");
    const log = await readAwayLog(db, { orgId: gainsOrgId(me.orgId), personId: personIdFor(me.id), since, now });
    return { rows: awayRows(log, me.timezone), since };
  } catch (err) {
    console.error("registro de quando a pessoa estava fora indisponível", err instanceof Error ? err.message : String(err));
    return { rows: [], since };
  }
}
