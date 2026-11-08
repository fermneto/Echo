import { timingSafeEqual } from "node:crypto";
import { PERSONAS } from "./demo/personas";
import type { Persona } from "./demo/types";

/**
 * Login da demonstração: usuário e senha. O usuário é o nome da persona (sem diferença de maiúscula nem de acento:
 * "fernando", "Inês" ou "ines"); a senha é a mesma para todas. Só vale com DEMO_MODE: fora dele, entra-se pelo Slack.
 */

export const DEMO_PASSWORD = "echo";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Persona pelo usuário digitado (id ou nome). */
export function demoUser(username: string): Persona | undefined {
  const u = norm(username);
  if (!u) return undefined;
  return PERSONAS.find((p) => norm(p.id) === u || norm(p.name) === u);
}

/** Usuário e senha da demonstração. Compara a senha em tempo constante. */
export function checkDemoLogin(username: string, password: string): Persona | null {
  const persona = demoUser(username);
  const want = Buffer.from(DEMO_PASSWORD);
  const got = Buffer.from(password);
  const ok = got.length === want.length && timingSafeEqual(got, want);
  return persona && ok ? persona : null;
}

/** Usuários da demonstração, para a dica na tela de entrada. */
export function demoUsernames(): string[] {
  return PERSONAS.map((p) => p.id);
}

/**
 * Persona pedida pelo link `/entrar?persona=…` (a landing manda `?persona=eduardo`), para preencher o campo Usuário.
 * Só aceita uma persona conhecida (pelo id, sem diferença de maiúscula nem de acento); o resto é ignorado.
 */
export function demoPersonaParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length > 80) return undefined;
  const u = norm(value);
  return PERSONAS.find((p) => norm(p.id) === u)?.id;
}
