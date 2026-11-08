"use server";

import { loadConfig } from "@echo/config";
import { revalidatePath } from "next/cache";
import { panelDb } from "@/lib/db";
import { gainsOrgId } from "@/lib/gains";
import { type CadastroState, parseOnboardingForm } from "@/lib/onboarding-form";
import { currentPersona } from "@/lib/session";

/**
 * Cadastro de pessoa pelo RH: o currículo vira o contexto inicial do gêmeo (modelo aberto) e a foto vira o
 * bonequinho (Claude escolhe traços de uma lista fechada). Só RH e liderança cadastram.
 */
export async function cadastrarPessoa(_prev: CadastroState, form: FormData): Promise<CadastroState> {
  const me = await currentPersona();
  if (!me || (me.role !== "hr" && me.role !== "leader")) return { status: "error", error: "Só o RH e a liderança cadastram pessoas." };
  const parsed = await parseOnboardingForm(form);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const f = parsed.fields;

  const db = panelDb();
  if (!db) return { status: "error", error: "O painel não tem banco ligado (DATABASE_URL), então não há onde cadastrar." };
  const cfg = loadConfig("web");
  const { serverOnboarding } = await import("@echo/agents/server");
  const onboard = serverOnboarding(db, {
    apiKey: cfg.ANTHROPIC_API_KEY,
    ollama: cfg.SLM_OLLAMA_URL ? { url: cfg.SLM_OLLAMA_URL, model: cfg.SLM_MODEL, timeoutMs: 60_000 } : undefined,
  });
  try {
    const r = await onboard({ orgId: gainsOrgId(me.orgId), name: f.name, role: f.role, timezone: f.timezone, workHours: f.workHours, ...(f.resumeText ? { resumeText: f.resumeText } : {}), ...(f.photo ? { photo: f.photo } : {}) });
    const notes = [
      r.photo === "model"
        ? "Bonequinho feito a partir da foto. A foto não foi guardada."
        : r.photo === "absent"
          ? "Sem foto: o bonequinho saiu de traços padrão."
          : cfg.ANTHROPIC_API_KEY
            ? "Não deu para ler a foto agora: o bonequinho saiu de traços padrão."
            : "Leitura da foto desligada neste ambiente (sem ANTHROPIC_API_KEY): o bonequinho saiu de traços padrão.",
      r.resume === "model"
        ? "Contexto lido do currículo pelo modelo aberto. O currículo não foi guardado."
        : r.resume === "absent"
          ? "Sem currículo: cargo e habilidades ficam para preencher na ficha."
          : cfg.SLM_OLLAMA_URL
            ? "O modelo aberto não respondeu: cargo e habilidades ficam para preencher na ficha."
            : "Leitura do currículo desligada neste ambiente (sem SLM_OLLAMA_URL): cargo e habilidades ficam para preencher na ficha.",
    ];
    revalidatePath("/equipe");
    return { status: "done", name: f.name, avatar: r.avatar, ...r.profile, notes, saved: true };
  } catch (err) {
    console.error("cadastro falhou", err instanceof Error ? err.message : String(err));
    return { status: "error", error: "Não foi possível cadastrar agora. Tente de novo." };
  }
}
