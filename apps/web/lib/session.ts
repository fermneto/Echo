import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadConfig } from "@echo/config";
import { canSee, type RouteId } from "./access";
import { findPersona } from "./demo/personas";
import type { Persona } from "./demo/types";

export const PERSONA_COOKIE = "echo_persona";

export function demoMode(): boolean {
  return loadConfig("web").DEMO_MODE;
}

/**
 * Pessoa logada. Por enquanto só existe o login por persona da demonstração (DEMO_MODE).
 * O login com o Slack (etapa 15, Frente 1) entra aqui depois.
 */
export async function currentPersona(): Promise<Persona | null> {
  if (!demoMode()) return null;
  const id = (await cookies()).get(PERSONA_COOKIE)?.value;
  return id ? (findPersona(id) ?? null) : null;
}

/** Exige login e permissão para a tela. Sem permissão, a tela não existe para essa pessoa. */
export async function requireAccess(route: RouteId): Promise<Persona> {
  const persona = await currentPersona();
  if (!persona) redirect("/entrar");
  if (!canSee(persona.role, route, { demo: demoMode() })) notFound();
  return persona;
}
