// Sincroniza a agenda com as ausências do Echo (etapa 18).
// - "Fora do escritório" curto vira ausência inferida, que já vale para isAway e para a volta prevista.
// - Longo (3 dias ou mais) vira sugestão para a liderança: nada de plano de redistribuição antes de confirmar.
// - Evento apagado ou movido na agenda atualiza ou cancela a ausência.
// - Expediente da agenda diferente do cadastrado vira sugestão; vale só depois que a pessoa confirma.
import { absences, auditLog, identities, people, withOrg, type Database } from "@echo/db";
import { and, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { CalendarSource } from "./calendar.ts";

const DAY = 24 * 60 * 60_000;
/** A partir daqui, a ausência da agenda é tratada como férias: sugestão, não plano automático. */
export const LONG_ABSENCE_MS = 3 * DAY;
/** Janela da sincronização: de ontem até 60 dias à frente. */
const WINDOW_BEFORE_MS = DAY;
const WINDOW_AFTER_MS = 60 * DAY;

export interface CalendarSyncResult {
  people: number;
  registered: number;
  updated: number;
  cancelled: number;
  /** Ausências longas novas, à espera da liderança. */
  suggestions: { absenceId: string; personId: string }[];
  /** Ausências curtas novas: já valem, sem confirmação. */
  shortRegistered: { absenceId: string; personId: string }[];
  workHoursSuggested: number;
  errors: string[];
}

export async function syncCalendar(db: Database, orgId: string, cal: CalendarSource, now: Date): Promise<CalendarSyncResult> {
  const res: CalendarSyncResult = { people: 0, registered: 0, updated: 0, cancelled: 0, suggestions: [], shortRegistered: [], workHoursSuggested: 0, errors: [] };
  const from = new Date(now.getTime() - WINDOW_BEFORE_MS);
  const to = new Date(now.getTime() + WINDOW_AFTER_MS);
  const prefix = `${cal.provider}:`;

  // Pessoas ativas com conta na agenda dessa plataforma.
  const accounts = await withOrg(db, orgId, (tx) =>
    tx
      .select({ personId: identities.personId, user: identities.externalId, workHours: people.workHours, timezone: people.timezone, suggested: people.workHoursSuggested })
      .from(identities)
      .innerJoin(people, eq(people.id, identities.personId))
      .where(and(eq(identities.orgId, orgId), eq(identities.platform, cal.provider), eq(people.active, true))),
  );
  res.people = accounts.length;

  for (const a of accounts) {
    try {
      const events = await cal.listOutOfOffice(a.user, from, to);
      const hours = await cal.workingHours(a.user).catch(() => null);
      await withOrg(db, orgId, async (tx) => {
        const known = await tx
          .select()
          .from(absences)
          .where(and(eq(absences.orgId, orgId), eq(absences.personId, a.personId), isNotNull(absences.calendarEventId), isNull(absences.cancelledAt)));
        const byEvent = new Map(known.filter((k) => k.calendarEventId!.startsWith(prefix)).map((k) => [k.calendarEventId!, k]));
        const seen = new Set<string>();

        for (const e of events) {
          const key = `${prefix}${e.id}`;
          seen.add(key);
          const long = e.end.getTime() - e.start.getTime() >= LONG_ABSENCE_MS;
          const prev = byEvent.get(key);
          if (prev) {
            if (prev.startsAt.getTime() !== e.start.getTime() || prev.endsAt.getTime() !== e.end.getTime()) {
              await tx.update(absences).set({ startsAt: e.start, endsAt: e.end }).where(eq(absences.id, prev.id));
              res.updated++;
            }
            continue;
          }
          const [row] = await tx
            .insert(absences)
            .values({
              orgId,
              personId: a.personId,
              startsAt: e.start,
              endsAt: e.end,
              kind: long ? "vacation" : "ooo",
              source: "calendar",
              calendarEventId: key,
              inferred: true,
              // Curta já vale; longa espera a liderança.
              confirmedAt: long ? null : now,
            })
            .onConflictDoNothing()
            .returning({ id: absences.id });
          if (!row) continue;
          res.registered++;
          (long ? res.suggestions : res.shortRegistered).push({ absenceId: row.id, personId: a.personId });
        }

        // Evento que sumiu da agenda (na janela): a ausência deixa de valer.
        const gone = known.filter((k) => k.calendarEventId!.startsWith(prefix) && !seen.has(k.calendarEventId!) && k.endsAt > from && k.startsAt < to).map((k) => k.id);
        if (gone.length) {
          await tx.update(absences).set({ cancelledAt: now }).where(inArray(absences.id, gone));
          res.cancelled += gone.length;
        }

        // Expediente da agenda diferente do cadastrado: só sugestão.
        if (hours) {
          const sameHours = (x: { days: number[]; start: string; end: string }, tz: string) =>
            hours.timezone === tz && hours.start === x.start && hours.end === x.end && hours.days.join() === [...x.days].sort().join();
          const same = sameHours(a.workHours, a.timezone);
          // Comparação campo a campo: o jsonb do Postgres devolve as chaves em outra ordem.
          const already = a.suggested ? sameHours(a.suggested, a.suggested.timezone) : false;
          if (!same && !already) {
            await tx.update(people).set({ workHoursSuggested: { ...hours, source: cal.provider } }).where(eq(people.id, a.personId));
            res.workHoursSuggested++;
          }
        }
      });
    } catch (err) {
      // Falha na agenda de uma pessoa não impede as outras.
      res.errors.push(`${a.personId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
}

/** A liderança confirma férias detectadas na agenda: só então elas podem gerar plano de redistribuição. */
export async function confirmCalendarAbsence(db: Database, orgId: string, absenceId: string, leaderId: string, now = new Date()): Promise<boolean> {
  return withOrg(db, orgId, async (tx) => {
    const [row] = await tx
      .update(absences)
      .set({ confirmedAt: now, confirmedBy: leaderId })
      .where(and(eq(absences.orgId, orgId), eq(absences.id, absenceId), eq(absences.source, "calendar"), isNull(absences.confirmedAt), isNull(absences.cancelledAt)))
      .returning({ id: absences.id });
    if (!row) return false;
    await tx.insert(auditLog).values({ orgId, actor: `person:${leaderId}`, action: "absence:confirmar_agenda", target: `absence:${absenceId}` });
    return true;
  });
}

/** A pessoa aceita o expediente sugerido pela agenda. */
export async function acceptSuggestedWorkHours(db: Database, orgId: string, personId: string): Promise<boolean> {
  return withOrg(db, orgId, async (tx) => {
    const [p] = await tx.select({ s: people.workHoursSuggested }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId)));
    if (!p?.s) return false;
    const { days, start, end, timezone } = p.s;
    await tx.update(people).set({ workHours: { days, start, end }, timezone, workHoursSuggested: null }).where(eq(people.id, personId));
    return true;
  });
}

/** Ausências que valem agora para a pessoa (para isAway): canceladas ficam de fora. */
export async function currentAbsences(db: Database, orgId: string, personIds: string[], at: Date) {
  if (!personIds.length) return [];
  return withOrg(db, orgId, (tx) =>
    tx
      .select({ personId: absences.personId, startsAt: absences.startsAt, endsAt: absences.endsAt, kind: absences.kind, inferred: absences.inferred, source: absences.source })
      .from(absences)
      .where(and(eq(absences.orgId, orgId), inArray(absences.personId, personIds), isNull(absences.cancelledAt), lt(absences.startsAt, new Date(at.getTime() + WINDOW_AFTER_MS)), gt(absences.endsAt, at))),
  );
}
