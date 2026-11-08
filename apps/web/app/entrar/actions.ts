"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { checkDemoLogin } from "@/lib/demo-login";
import { demoMode, PERSONA_COOKIE } from "@/lib/session";

export type EntrarState = { error?: string; username?: string };

/** Login da demonstração por usuário e senha. Fora de DEMO_MODE, não existe: entra-se pelo Slack. */
export async function entrarComSenha(_prev: EntrarState, formData: FormData): Promise<EntrarState> {
  const username = String(formData.get("usuario") ?? "").slice(0, 80);
  const password = String(formData.get("senha") ?? "").slice(0, 200);
  if (!demoMode()) return { error: "Este ambiente não tem login por senha. Entre com o Slack." };
  const persona = checkDemoLogin(username, password);
  // Mesma mensagem para usuário e senha errados: não diz qual dos dois falhou.
  if (!persona) return { error: "Usuário ou senha incorretos.", username };
  const jar = await cookies();
  jar.set(PERSONA_COOKIE, persona.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  // Vale o último login: entrar por senha encerra a sessão do Slack.
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

export async function sair(): Promise<void> {
  const jar = await cookies();
  jar.delete(PERSONA_COOKIE);
  jar.delete(SESSION_COOKIE);
  redirect("/entrar");
}
