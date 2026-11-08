"use server";

import { loadConfig } from "@echo/config";
import { revalidatePath } from "next/cache";
import { panelDb } from "@/lib/db";
import { gainsOrgId } from "@/lib/gains";
import { canRegisterPeople, linkablePlatforms } from "@/lib/access";
import { conflictMessage, parseAccountsForm, SLACK_FORMAT_ONLY_NOTE } from "@/lib/accounts-form";
import { slackDirectory } from "@/lib/accounts-server";
import { membersOf, slackDirectoryFor } from "@/lib/slack-directory";
import { parseOnboardingForm } from "@/lib/onboarding-form";
import type { CadastroState } from "@/lib/onboarding-options";
import { personIdFor } from "@/lib/agent";
import { teamsFor } from "@/lib/scope";
import { currentPersona, isDemoSession } from "@/lib/session";

/**
 * Cadastro de pessoa pelo RH: o currículo vira o contexto inicial do gêmeo (modelo aberto) e a foto vira o
 * bonequinho (Claude escolhe traços de uma lista fechada). Só o RH cadastra (`canRegisterPeople`).
 * Na demonstração (persona escolhida em /entrar), só pré-visualiza: nada é gravado e nenhum modelo é chamado.
 */
export async function cadastrarPessoa(_prev: CadastroState, form: FormData): Promise<CadastroState> {
  const me = await currentPersona();
  if (!me || !canRegisterPeople(me.role)) return { status: "error", error: "Só o RH cadastra pessoas." };
  const parsed = await parseOnboardingForm(form, ((await teamsFor(me)) ?? []).map((t) => t.id));
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const f = parsed.fields;
  const db = panelDb();
  // Conferido aqui, não só escondido na tela: a liderança não liga o Slack de ninguém.
  const platforms = linkablePlatforms(me, { id: "", role: f.role, teamId: f.teamId });
  // Na demonstração, o Slack real nunca é lido (nem users.list).
  const slack = await slackDirectoryFor({ demo: isDemoSession(me), canLinkSlack: Boolean(db) && platforms.includes("slack"), read: () => slackDirectory(db!, gainsOrgId(me.orgId)) });
  const accounts = parseAccountsForm(form, membersOf(slack), platforms);
  if (!accounts.ok) return { status: "error", error: accounts.error };
  const { NO_SLACK_NOTE } = await import("@echo/domain");
  const hasSlack = accounts.links.some((l) => l.platform === "slack");
  const slackNote = hasSlack ? (slack.status === "failed" ? [SLACK_FORMAT_ONLY_NOTE] : []) : [NO_SLACK_NOTE];

  if (isDemoSession(me)) {
    const { traitsFromSeed } = await import("@echo/domain");
    return {
      status: "done",
      name: f.name,
      avatar: traitsFromSeed(`${me.orgId}:${f.name}`),
      jobTitle: null,
      skills: [],
      areas: [],
      languages: [],
      notes: ["Demonstração: nada foi gravado. A foto e o currículo não saíram do painel, e o bonequinho saiu de traços padrão.", ...slackNote],
      saved: false,
    };
  }

  if (!db) return { status: "error", error: "O painel não tem banco ligado (DATABASE_URL), então não há onde cadastrar." };
  const cfg = loadConfig("web");
  const { AccountConflictError, serverOnboarding } = await import("@echo/agents/server");
  const onboard = serverOnboarding(db, { apiKey: cfg.ANTHROPIC_API_KEY });
  try {
    const r = await onboard({ orgId: gainsOrgId(me.orgId), actorId: personIdFor(me.id), name: f.name, role: f.role, ...(f.teamId ? { teamId: f.teamId } : {}), timezone: f.timezone, workHours: f.workHours, ...(f.resumeText ? { resumeText: f.resumeText } : {}), ...(f.photo ? { photo: f.photo } : {}), accounts: accounts.links });
    const notes = [
      r.photo === "model"
        ? "Bonequinho feito a partir da foto. A foto não foi guardada."
        : r.photo === "absent"
          ? "Sem foto: o bonequinho saiu de traços padrão."
          : cfg.ANTHROPIC_API_KEY
            ? "Não deu para ler a foto agora: o bonequinho saiu de traços padrão."
            : "Leitura da foto desligada neste ambiente (sem ANTHROPIC_API_KEY): o bonequinho saiu de traços padrão.",
      r.resume === "model"
        ? "Contexto lido do currículo. O currículo não foi guardado."
        : r.resume === "absent"
          ? "Sem currículo: cargo e habilidades ficam para preencher na ficha."
          : cfg.ANTHROPIC_API_KEY
            ? "Não deu para ler o currículo agora: cargo e habilidades ficam para preencher na ficha."
            : "Leitura do currículo desligada neste ambiente (sem ANTHROPIC_API_KEY): cargo e habilidades ficam para preencher na ficha.",
      ...slackNote,
    ];
    revalidatePath("/equipe");
    revalidatePath("/");
    return { status: "done", personId: r.personId, name: f.name, avatar: r.avatar, ...r.profile, notes, saved: true };
  } catch (err) {
    const { OnboardingLimitError, ONBOARDING_LIMIT } = await import("@echo/agents");
    if (err instanceof AccountConflictError) return { status: "error", error: `${conflictMessage(err.platform, err.otherName)} Nada foi cadastrado.` };
    if (err instanceof OnboardingLimitError) return { status: "error", error: `A empresa chegou ao limite de ${ONBOARDING_LIMIT.perHour} cadastros por hora. Tente de novo mais tarde.` };
    console.error("cadastro falhou", err instanceof Error ? err.message : String(err));
    return { status: "error", error: "Não foi possível cadastrar agora. Tente de novo." };
  }
}

export type CanalVideoState = { status: "idle" } | { status: "done"; channel: string | null; message: string } | { status: "error"; error: string };

/**
 * Canal do Slack onde sai o vídeo da semana (da equipe, ou o de reserva da empresa). Liderança e RH, pela regra de
 * `editableVideoChannels`. O id é conferido (C…); campo vazio tira o canal e o vídeo fica só no painel.
 * Na demonstração, nada é gravado.
 */
export async function salvarCanalVideo(_prev: CanalVideoState, form: FormData): Promise<CanalVideoState> {
  const me = await currentPersona();
  if (!me || (me.role !== "hr" && me.role !== "leader")) return { status: "error", error: "Só o RH e a liderança mudam o canal do vídeo." };
  const target = String(form.get("alvo") ?? "");
  const raw = String(form.get("canal") ?? "").trim();
  const { parseSlackChannelId } = await import("@echo/domain");
  const channel = raw ? parseSlackChannelId(raw) : null;
  if (raw && !channel) return { status: "error", error: "Use o id do canal público, como C0123ABCD45 (no Slack: detalhes do canal, no fim da aba Sobre)." };
  if (isDemoSession(me)) return { status: "done", channel, message: "Demonstração: nada foi gravado." };
  const db = panelDb();
  if (!db) return { status: "error", error: "O painel não tem banco ligado (DATABASE_URL), então não há onde gravar." };
  const { readVideoChannels, saveVideoChannel } = await import("@echo/agents/server");
  const { canEditVideoChannel, ORG_TARGET } = await import("@/lib/video-channel");
  const orgId = gainsOrgId(me.orgId);
  if (!canEditVideoChannel(me, await readVideoChannels(db, orgId), target)) return { status: "error", error: "Esse canal não é seu para mudar." };
  const ok = await saveVideoChannel(db, orgId, { teamId: target === ORG_TARGET ? null : target, channel, actorId: personIdFor(me.id) });
  if (!ok) return { status: "error", error: "Não foi possível gravar agora. Tente de novo." };
  revalidatePath("/configuracao");
  return { status: "done", channel, message: channel ? `Gravado. O próximo vídeo sai em ${channel}; convide o Echo para o canal, se ainda não estiver lá.` : "Canal tirado. O vídeo fica só no painel." };
}
