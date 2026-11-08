"use server";

import { loadConfig } from "@echo/config";
import { revalidatePath } from "next/cache";
import { canAskTwin, canEditProfile, linkablePlatforms } from "@/lib/access";
import { accountValues, conflictMessage, parseAccountsForm, SLACK_FORMAT_ONLY_NOTE } from "@/lib/accounts-form";
import { slackDirectory } from "@/lib/accounts-server";
import { membersOf, slackDirectoryFor } from "@/lib/slack-directory";
import type { ContasState } from "@/lib/accounts-state";
import { askAgent, panelRequest, personIdFor, recordIn } from "@/lib/agent";
import { saveDemoProfile } from "@/lib/agent-profile-store";
import { panelDb } from "@/lib/db";
import { askTwinDemo } from "@/lib/demo/twin";
import { gainsOrgId } from "@/lib/gains";
import { type BonequinhoState, readTraitsForm } from "@/lib/avatar-form";
import { parsePhoto } from "@/lib/onboarding-form";
import { droppedCount, type PerfilState, parseProfileForm } from "@/lib/profile-form";
import { teamScope } from "@/lib/scope";
import { currentPersona, isDemoSession } from "@/lib/session";
import { loadTeam } from "@/lib/team-live";

import { MAX_QUESTION, type AskState } from "@/lib/ask";

/** Pessoa do recorte de quem está logado, já com quem foi cadastrado no painel. */
async function visibleTarget(me: NonNullable<Awaited<ReturnType<typeof currentPersona>>>, id: string) {
  const scope = await teamScope(me, await loadTeam(new Date(), { orgId: me.orgId }));
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

/** `style` e `delegation`: o que ficou gravado (já limpo), para a tela mostrar o texto salvo e não o de antes. */
export type ProfileState = { saved?: string; error?: string; style?: string; delegation?: string };

/** O próprio texto do agente: como ele responde e até onde decide pela pessoa. Só a pessoa grava o dela. */
export async function salvarPerfilDoAgente(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const me = await currentPersona();
  if (!me || String(formData.get("pessoa") ?? "") !== me.id) return { error: "Só a própria pessoa muda o jeito do agente dela." };
  const db = panelDb();
  const input = { style: String(formData.get("estilo") ?? ""), delegation: String(formData.get("delegacao") ?? "") };
  const { cleanAgentText } = await import("@echo/domain");
  const stored = { style: cleanAgentText(input.style) ?? "", delegation: cleanAgentText(input.delegation) ?? "" };
  if (!db) {
    // Demonstração sem banco: fica só neste navegador.
    await saveDemoProfile(input, new Date());
    return { saved: new Date().toISOString(), ...stored };
  }
  const { saveAgentProfile } = await import("@echo/agents/perfil");
  const ok = await saveAgentProfile(db, gainsOrgId(me.orgId), personIdFor(me.id), input, new Date());
  if (!ok) return { error: "Pessoa não encontrada nesta empresa." };
  // Sem isto, a ficha continuava com o texto de antes (e a data da delegação) até recarregar a página.
  revalidatePath(`/pessoas/${me.id}`);
  return { saved: new Date().toISOString(), ...stored };
}

/**
 * Editar perfil na ficha de quem foi cadastrado no painel: RH, liderança da equipe ou a própria pessoa.
 * Na demonstração, não grava.
 * Passa pelo mesmo validador do currículo e fica registrado em `audit_log`.
 */
export async function salvarPerfil(_prev: PerfilState, formData: FormData): Promise<PerfilState> {
  const ctx = await editableTarget(formData, "o perfil");
  if (!ctx.ok) return { status: "error", error: ctx.error };

  const input = parseProfileForm(formData);
  const { cleanProfile } = await import("@echo/agents");
  const profile = cleanProfile(input);
  const { updateProfile } = await import("@echo/agents/server");
  const ok = await updateProfile(ctx.db, ctx.orgId, ctx.target.id, profile, ctx.actorId);
  if (!ok) return { status: "error", error: "Não foi possível salvar agora. Tente de novo." };
  revalidatePath(`/pessoas/${ctx.target.id}`);
  revalidatePath("/equipe");
  return { status: "saved", profile, dropped: droppedCount(input, profile) };
}

/**
 * Contas da pessoa no Slack, GitHub e Linear (identities): só o RH e a liderança da equipe. É pela conta do
 * Slack que a pessoa entra no painel e é reconhecida nas menções. Na demonstração, não grava.
 */
export async function salvarContas(_prev: ContasState, formData: FormData): Promise<ContasState> {
  const me = await currentPersona();
  if (!me) return { status: "error", error: "Entre de novo para editar." };
  const target = await visibleTarget(me, String(formData.get("pessoa") ?? ""));
  if (!target || !target.registered) return { status: "error", error: "Pessoa não encontrada." };
  // Por plataforma, conferido aqui e não só na tela: o Slack só o RH; GitHub e Linear também a liderança da
  // equipe; ninguém fora do RH mexe nas próprias contas.
  const platforms = linkablePlatforms(me, target);
  if (!platforms.length) return { status: "error", error: "Só o RH e a liderança da equipe ligam as contas da pessoa, e ninguém fora do RH liga as próprias." };
  if (isDemoSession(me)) return { status: "error", error: "Demonstração: as contas não são gravadas." };
  const db = panelDb();
  if (!db) return { status: "error", error: "O painel não tem banco ligado (DATABASE_URL)." };
  const orgId = gainsOrgId(me.orgId);
  const slack = await slackDirectoryFor({ demo: false, canLinkSlack: platforms.includes("slack"), read: () => slackDirectory(db, orgId) });
  const parsed = parseAccountsForm(formData, membersOf(slack), platforms);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  try {
    const { readAccounts, saveAccounts } = await import("@echo/agents/server");
    // Só as plataformas permitidas são trocadas; as outras (o Slack, para a liderança) ficam como estão.
    const r = await saveAccounts(db, orgId, target.id, parsed.links, personIdFor(me.id), platforms);
    if (r.status === "not_found") return { status: "error", error: "Pessoa não encontrada." };
    if (r.status === "conflict") return { status: "error", error: conflictMessage(r.platform, r.otherName) };
    revalidatePath(`/pessoas/${target.id}`);
    const note = slack.status === "failed" && parsed.links.some((l) => l.platform === "slack") ? SLACK_FORMAT_ONLY_NOTE : undefined;
    return { status: "saved", values: accountValues(await readAccounts(db, orgId, target.id)), ...(note ? { note } : {}) };
  } catch (err) {
    // Sem o erro cru na tela nem os ids no log.
    console.error("contas: falha ao salvar", err instanceof Error ? err.name : "erro");
    return { status: "error", error: "Não foi possível salvar as contas agora. Confira a ficha e tente de novo." };
  }
}

/**
 * Quem pode trocar o perfil ou o bonequinho de uma pessoa cadastrada no painel, e com que banco. Devolve a
 * mensagem de erro em português quando não pode (inclusive na demonstração, que não grava).
 */
async function editableTarget(formData: FormData, what: string) {
  const me = await currentPersona();
  if (!me) return { ok: false, error: "Entre de novo para editar." } as const;
  const target = await visibleTarget(me, String(formData.get("pessoa") ?? ""));
  if (!target || !target.registered) return { ok: false, error: "Pessoa não encontrada." } as const;
  if (!canEditProfile(me, target)) return { ok: false, error: `Só o RH, a liderança da equipe ou a própria pessoa trocam ${what}.` } as const;
  if (isDemoSession(me)) return { ok: false, error: `Demonstração: ${what} não é gravado.` } as const;
  const db = panelDb();
  if (!db) return { ok: false, error: "O painel não tem banco ligado (DATABASE_URL)." } as const;
  return { ok: true, me, target, db, orgId: gainsOrgId(me.orgId), actorId: personIdFor(me.id) } as const;
}

const REDO_ERRORS = {
  not_found: "Pessoa não encontrada.",
  no_model: "A leitura da foto está desligada neste ambiente (sem ANTHROPIC_API_KEY). Ajuste os traços à mão.",
  limit: "A empresa chegou ao limite de refações por hora. Tente de novo mais tarde ou ajuste à mão.",
  unreadable: "Não deu para ler essa foto. O bonequinho ficou como estava; tente outra foto ou ajuste à mão.",
  invalid: "Algum traço não está na lista. Escolha de novo.",
} as const;

/** Refazer o bonequinho por uma foto nova. A foto não é guardada; se o modelo falha, nada muda. */
export async function refazerBonequinho(_prev: BonequinhoState, formData: FormData): Promise<BonequinhoState> {
  const ctx = await editableTarget(formData, "o bonequinho");
  if (!ctx.ok) return { status: "error", error: ctx.error };
  const photo = await parsePhoto(formData);
  if (typeof photo === "string") return { status: "error", error: photo };
  if (!photo) return { status: "error", error: "Escolha uma foto." };

  const { serverAvatar } = await import("@echo/agents/server");
  const r = await serverAvatar(ctx.db, loadConfig("web").ANTHROPIC_API_KEY).redo({ orgId: ctx.orgId, personId: ctx.target.id, actorId: ctx.actorId, photo });
  if (r.status !== "saved") return { status: "error", error: REDO_ERRORS[r.status] };
  revalidatePath(`/pessoas/${ctx.target.id}`);
  revalidatePath("/equipe");
  revalidatePath("/dashboard");
  return { status: "saved", traits: r.traits, note: r.kept.length ? "Bonequinho refeito. Alguns traços ficaram como estavam." : "Bonequinho refeito pela foto. A foto não foi guardada." };
}

/** Ajustar os traços à mão, só com valores da lista fechada. */
export async function ajustarBonequinho(_prev: BonequinhoState, formData: FormData): Promise<BonequinhoState> {
  const ctx = await editableTarget(formData, "o bonequinho");
  if (!ctx.ok) return { status: "error", error: ctx.error };
  const { serverAvatar } = await import("@echo/agents/server");
  const r = await serverAvatar(ctx.db, undefined).adjust({ orgId: ctx.orgId, personId: ctx.target.id, actorId: ctx.actorId, traits: readTraitsForm(formData) });
  if (r.status !== "saved") return { status: "error", error: REDO_ERRORS[r.status] };
  revalidatePath(`/pessoas/${ctx.target.id}`);
  revalidatePath("/equipe");
  revalidatePath("/dashboard");
  return { status: "saved", traits: r.traits, note: "Bonequinho ajustado." };
}
