"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findPersona } from "@/lib/demo/personas";
import { SESSION_COOKIE } from "@/lib/auth";
import { demoMode, PERSONA_COOKIE } from "@/lib/session";

export async function entrarComo(formData: FormData): Promise<void> {
  const persona = findPersona(String(formData.get("persona") ?? ""));
  if (!demoMode() || !persona) redirect("/entrar");
  const jar = await cookies();
  jar.set(PERSONA_COOKIE, persona.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  // Vale o último login: escolher uma persona encerra a sessão do Slack.
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

export async function sair(): Promise<void> {
  const jar = await cookies();
  jar.delete(PERSONA_COOKIE);
  jar.delete(SESSION_COOKIE);
  redirect("/entrar");
}
