"use server";

import { revalidatePath } from "next/cache";
import { canAskTwin, canEditProfile } from "@/lib/access";
import { askAgent, panelRequest, personIdFor, recordIn } from "@/lib/agent";
import { saveDemoProfile } from "@/lib/agent-profile-store";
import { panelDb } from "@/lib/db";
import { askTwinDemo } from "@/lib/demo/twin";
import { gainsOrgId } from "@/lib/gains";
import { droppedCount, type PerfilState, parseProfileForm } from "@/lib/profile-form";
import { teamScope } from "@/lib/scope";
import { currentPersona, isDemoSession } from "@/lib/session";
import { loadTeam } from "@/lib/team-live";

import { MAX_QUESTION, type AskState } from "@/lib/ask";

/** Pessoa do recorte de quem está logado, já com quem foi cadastrado no painel. */
async function visibleTarget(me: NonNullable<Awaited<ReturnType<typeof currentPersona>>>, id: string) {
  const scope = await teamScope(me, await loadTeam(new Date()));
  return scope.people.find((p) => p.id === id);
}

/** Pergunte ao gêmeo: o mesmo fluxo F2 do Slack. Sem banco ligado ao painel, vale a resposta simulada da demo. */
export async function perguntar(prev: AskState, formData: FormData): Promise<AskState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { ...prev, error: "Você não tem permissão para perguntar ao gêmeo." };

  const target = await visibleTarget(me, String(formData.get("pessoa") ?? ""));
  const question = String(formData.get("pergunta") ?? "").trim().slice(0, MAX_QUESTION);
  if (!target) return { ...prev, error: "Pessoa não encontrada." };
  if (!question) return { ...prev, error: "Escreva uma pergunta." };

  const db = panelDb();
  if (!db) {
    // A simulação responde na hora; a pausa imita o tempo de consulta do fluxo real (nota, GitHub, Linear).
    await new Promise((r) => setTimeout(r, 900));
    return { turns: [...prev.turns, { question, reply: askTwinDemo(target, question) }] };
  }
  const r = await askAgent(panelRequest({ orgId: me.orgId, askerId: me.id, ownerId: target.id, question }), { record: recordIn(db) });
  return r.ok ? { turns: [...prev.turns, { question, reply: r.reply }] } : { ...prev, error: r.error };
}

export type ProfileState = { saved?: string; error?: string };

/** O próprio texto do agente: como ele responde e até onde decide pela pessoa. Só a pessoa grava o dela. */
export async function salvarPerfilDoAgente(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const me = await currentPersona();
  if (!me || String(formData.get("pessoa") ?? "") !== me.id) return { error: "Só a própria pessoa muda o jeito do agente dela." };
  const db = panelDb();
  const input = { style: String(formData.get("estilo") ?? ""), delegation: String(formData.get("delegacao") ?? "") };
  if (!db) {
    // Demonstração sem banco: fica só neste navegador.
    await saveDemoProfile(input, new Date());
    return { saved: new Date().toISOString() };
  }
  const { saveAgentProfile } = await import("@echo/agents/perfil");
  const ok = await saveAgentProfile(db, gainsOrgId(me.orgId), personIdFor(me.id), input, new Date());
  return ok ? { saved: new Date().toISOString() } : { error: "Pessoa não encontrada nesta empresa." };
}

/**
 * Editar perfil na ficha de quem foi cadastrado no painel: RH, liderança da equipe ou a própria pessoa.
 * Na demonstração, não grava.
 * Passa pelo mesmo validador do currículo e fica registrado em `audit_log`.
 */
export async function salvarPerfil(_prev: PerfilState, formData: FormData): Promise<PerfilState> {
  const me = await currentPersona();
  if (!me) return { status: "error", error: "Entre de novo para editar." };
  const target = await visibleTarget(me, String(formData.get("pessoa") ?? ""));
  if (!target || !target.registered) return { status: "error", error: "Pessoa não encontrada." };
  if (!canEditProfile(me, target)) return { status: "error", error: "Só o RH, a liderança da equipe ou a própria pessoa editam o perfil." };
  // Persona da demonstração (escolhida em /entrar): pode abrir a edição, mas nada é gravado.
  if (isDemoSession(me)) return { status: "error", error: "Demonstração: o perfil não é gravado." };
  const db = panelDb();
  if (!db) return { status: "error", error: "O painel não tem banco ligado (DATABASE_URL)." };

  const input = parseProfileForm(formData);
  const { cleanProfile } = await import("@echo/agents");
  const profile = cleanProfile(input);
  const { updateProfile } = await import("@echo/agents/server");
  const ok = await updateProfile(db, gainsOrgId(me.orgId), target.id, profile, personIdFor(me.id));
  if (!ok) return { status: "error", error: "Não foi possível salvar agora. Tente de novo." };
  revalidatePath(`/pessoas/${target.id}`);
  revalidatePath("/equipe");
  return { status: "saved", profile, dropped: droppedCount(input, profile) };
}
