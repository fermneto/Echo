import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadConfig } from "@echo/config";
import { canSee, type RouteId } from "./access";
import { loadPanelPerson } from "@echo/connectors";
import { readSession, SESSION_COOKIE } from "./auth";
import { panelDb } from "./db";
import { findPersona } from "./demo/personas";
import type { Persona } from "./demo/types";

export const PERSONA_COOKIE = "echo_persona";

export function demoMode(): boolean {
  return loadConfig("web").DEMO_MODE;
}

/**
 * Pessoa logada: persona da demonstração (DEMO_MODE) ou quem entrou com o Slack.
 * A sessão do Slack guarda só ids; a pessoa é lida do banco a cada página, então desligamento
 * ou troca de papel valem na hora.
 */
export async function currentPersona(): Promise<Persona | null> {
  const jar = await cookies();
  if (demoMode()) {
    const id = jar.get(PERSONA_COOKIE)?.value;
    const persona = id ? findPersona(id) : undefined;
    if (persona) return persona;
  }
  const secret = loadConfig("web").SESSION_SECRET;
  const session = secret ? readSession(secret, jar.get(SESSION_COOKIE)?.value) : null;
  const db = session ? panelDb() : null;
  if (!session || !db) return null;
  const p = await loadPanelPerson(db, session.orgId, session.personId);
  return p ? personaFromPerson(p) : null;
}

/** Pessoa do banco no formato que as telas usam. Cidade sai do fuso; disponibilidade é provisória até isAway. */
function personaFromPerson(p: NonNullable<Awaited<ReturnType<typeof loadPanelPerson>>>): Persona {
  const city = (p.timezone.split("/").pop() ?? p.timezone).replace(/_/g, " ");
  const role = p.role === "leader" || p.role === "hr" ? p.role : "member";
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    role,
    teamId: p.teamId ?? undefined,
    timezone: p.timezone,
    workHours: p.workHours,
    skills: p.skills,
    areas: p.areas,
    active: p.active,
    title: p.jobTitle ?? "",
    story: "",
    city,
    cityCode: city.slice(0, 3).toUpperCase(),
    availability: { kind: "working" },
  };
}

/** Exige login e permissão para a tela. Sem permissão, a tela não existe para essa pessoa. */
export async function requireAccess(route: RouteId): Promise<Persona> {
  const persona = await currentPersona();
  if (!persona) redirect("/entrar");
  if (!canSee(persona.role, route, { demo: demoMode() })) notFound();
  return persona;
}
