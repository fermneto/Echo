"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TEAMS } from "@/lib/demo/teams";
import { FOLLOWED_TEAMS_COOKIE } from "@/lib/scope";
import { currentPersona } from "@/lib/session";

/** O RH escolhe quais equipes acompanhar. Só ids de equipes que existem; quem não é do RH não muda nada. */
export async function acompanharEquipes(formData: FormData): Promise<void> {
  const me = await currentPersona();
  const back = String(formData.get("voltar") ?? "/");
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/";
  if (!me || me.role !== "hr") redirect(safeBack);
  const ids = new Set(TEAMS.map((t) => t.id));
  const chosen = formData.getAll("equipe").map(String).filter((id) => ids.has(id));
  (await cookies()).set(FOLLOWED_TEAMS_COOKIE, JSON.stringify(chosen), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
  redirect(safeBack);
}
