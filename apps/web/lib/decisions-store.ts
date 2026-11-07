import { cookies } from "next/headers";

/**
 * Decisões da liderança (aprovar o plano de uma ausência, distribuir um item sem responsável).
 * Ficam num cookie por visitante até o outbox (packages/actions) ligar no painel; o painel inteiro
 * lê daqui, então o plano, o início e a auditoria mostram o mesmo estado.
 */

export type Decision = { by: string; at: string };
export type Decisions = Partial<Record<"ferias-bruno" | "ech-160", Decision>>;
export type DecisionId = keyof Decisions;

const COOKIE = "echo_decisoes";
const IDS: readonly DecisionId[] = ["ferias-bruno", "ech-160"];

export function parseDecisions(raw: string | undefined): Decisions {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    const out: Decisions = {};
    for (const id of IDS) {
      const d = (data as Record<string, unknown>)[id] as Partial<Decision> | undefined;
      if (d && typeof d.by === "string" && typeof d.at === "string") out[id] = { by: d.by.slice(0, 40), at: d.at.slice(0, 20) };
    }
    return out;
  } catch {
    return {};
  }
}

export async function currentDecisions(): Promise<Decisions> {
  return parseDecisions((await cookies()).get(COOKIE)?.value);
}

export async function saveDecision(id: DecisionId, decision: Decision | null): Promise<void> {
  const jar = await cookies();
  const next = { ...parseDecisions(jar.get(COOKIE)?.value) };
  if (decision) next[id] = decision;
  else delete next[id];
  jar.set(COOKIE, JSON.stringify(next), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
}

export async function resetDecisions(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export { stamp } from "./time";
