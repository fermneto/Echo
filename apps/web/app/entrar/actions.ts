"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findPersona } from "@/lib/demo/personas";
import { demoMode, PERSONA_COOKIE } from "@/lib/session";

export async function entrarComo(formData: FormData): Promise<void> {
  const persona = findPersona(String(formData.get("persona") ?? ""));
  if (!demoMode() || !persona) redirect("/entrar");
  (await cookies()).set(PERSONA_COOKIE, persona.id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect("/");
}

export async function sair(): Promise<void> {
  (await cookies()).delete(PERSONA_COOKIE);
  redirect("/entrar");
}
