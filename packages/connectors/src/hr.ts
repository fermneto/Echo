// Aviso de RH genérico (porta HrSource): POST assinado em /webhooks/rh/o/<empresa>.
// O motivo da ausência é descartado na entrada; matrícula desconhecida vira só uma contagem.
import { randomBytes } from "node:crypto";
import { absences, auditLog, identities, installations, type Database } from "@echo/db";
import { and, eq, isNull } from "drizzle-orm";
import type { TokenCipher } from "./crypto.ts";

export type HrEvent =
  | { id: string; employeeId: string; startsAt: Date; endsAt: Date; kind: "vacation" | "leave" }
  | { id: string; action: "cancel" };

const KINDS = new Set(["vacation", "leave"]);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Lê o aviso e fica só com o necessário. Campos como "reason", "motivo" ou CID nunca saem daqui.
 * Datas com fuso (ISO 8601). Retorna null se o aviso for inválido.
 */
export function parseHrEvent(body: unknown): HrEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!isStr(b.id) || b.id.length > 200) return null;
  if (b.action === "cancel") return { id: b.id, action: "cancel" };
  if (!isStr(b.employee_id) || !isStr(b.starts_at) || !isStr(b.ends_at)) return null;
  const kind = isStr(b.kind) && KINDS.has(b.kind) ? (b.kind as "vacation" | "leave") : null;
  if (!kind) return null;
  // Exige fuso explícito: sem ele, a mesma data cairia em dias diferentes conforme o servidor.
  if (![b.starts_at, b.ends_at].every((d) => /([+-]\d{2}:\d{2}|Z)$/.test(d as string))) return null;
  const startsAt = new Date(b.starts_at);
  const endsAt = new Date(b.ends_at);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return null;
  return { id: b.id, employeeId: b.employee_id, startsAt, endsAt, kind };
}

export type HrResult =
  | { status: "registered"; absenceId: string; personId: string }
  | { status: "duplicate" }
  | { status: "cancelled" }
  | { status: "unknown_event" }
  | { status: "unknown_employee" };

/** Grava a ausência (ou o cancelamento). O mesmo id não duplica. */
export async function applyHrEvent(db: Database, orgId: string, ev: HrEvent): Promise<HrResult> {
  if ("action" in ev) {
    const rows = await db
      .update(absences)
      .set({ cancelledAt: new Date() })
      .where(and(eq(absences.orgId, orgId), eq(absences.hrEventId, ev.id), isNull(absences.cancelledAt)))
      .returning({ id: absences.id });
    return rows.length ? { status: "cancelled" } : { status: "unknown_event" };
  }
  const [who] = await db
    .select({ personId: identities.personId })
    .from(identities)
    .where(and(eq(identities.orgId, orgId), eq(identities.platform, "rh"), eq(identities.externalId, ev.employeeId)));
  if (!who) {
    // Só a contagem: nem a matrícula nem as datas ficam guardadas.
    await db.insert(auditLog).values({ orgId, actor: "rh", action: "rh:matricula_desconhecida", target: "rh:aviso" });
    return { status: "unknown_employee" };
  }
  const [row] = await db
    .insert(absences)
    .values({ orgId, personId: who.personId, startsAt: ev.startsAt, endsAt: ev.endsAt, kind: ev.kind, source: "hr", hrEventId: ev.id })
    .onConflictDoNothing()
    .returning({ id: absences.id });
  if (!row) return { status: "duplicate" };
  await db.insert(auditLog).values({ orgId, actor: "rh", action: "rh:ausencia_registrada", target: `absence:${row.id}` });
  return { status: "registered", absenceId: row.id, personId: who.personId };
}

/** Segredo do aviso de RH da empresa, guardado cifrado em installations (kind "rh"). */
export async function hrSecret(db: Database, cipher: TokenCipher, orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ sealed: installations.tokensEncrypted })
    .from(installations)
    .where(and(eq(installations.orgId, orgId), eq(installations.kind, "rh")));
  return row?.sealed ? cipher.decrypt(row.sealed) : null;
}

/** Gera (ou troca) o segredo do aviso de RH. Mostrado uma vez para quem configura o sistema de RH. */
export async function rotateHrSecret(db: Database, cipher: TokenCipher, orgId: string): Promise<string> {
  const secret = randomBytes(32).toString("hex");
  const sealed = cipher.encrypt(secret);
  await db
    .insert(installations)
    .values({ orgId, kind: "rh", externalId: `rh:${orgId}`, tokensEncrypted: sealed })
    .onConflictDoUpdate({ target: [installations.kind, installations.externalId], set: { tokensEncrypted: sealed } });
  return secret;
}
