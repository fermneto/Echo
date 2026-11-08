// Trocar o bonequinho de quem já está cadastrado: por uma foto nova (Claude escolhe traços da lista fechada,
// como no cadastro) ou à mão, escolhendo os traços. A foto fica só na memória do pedido. Quem decide é a
// pessoa que envia; o modelo não grava nada: o código do fluxo grava os traços validados e o audit_log.
import { AVATAR_LISTS, type AvatarTraits, type Clock, parseAvatarTraits, systemClock } from "@echo/domain";
import type { RunRecorder } from "@echo/observability";
import type { ModelCall } from "./answer.ts";
import { MODELS } from "./index.ts";
import { type PhotoType, readPhoto } from "./onboarding.ts";

export type AvatarAction = "avatar:refazer" | "avatar:ajustar";

export interface AvatarStore {
  /** Traços atuais (os gravados ou os estáveis do id); undefined se a pessoa não é da empresa ou foi desligada. */
  current(orgId: string, personId: string): Promise<AvatarTraits | undefined>;
  /** Grava os traços e registra quem trocou em `audit_log`, na mesma transação. */
  update(orgId: string, personId: string, traits: AvatarTraits, actorId: string, action: AvatarAction): Promise<boolean>;
  /** Quantas vezes a empresa refez bonequinho pela foto desde `since`. */
  recentRedos(orgId: string, since: Date): Promise<number>;
}

export interface RedoAvatarDeps {
  store: AvatarStore;
  /** Claude para a foto. Sem chave, só o ajuste à mão. */
  vision?: ModelCall | null;
  recorder: RunRecorder;
  clock?: Clock;
  timeoutMs?: number;
}

/** Cada refação pela foto chama o Claude com visão. */
export const REDO_LIMIT = { perHour: 10 } as const;

export type RedoOutcome =
  | { status: "saved"; traits: AvatarTraits; /** Campos que o modelo devolveu fora da lista e ficaram como estavam. */ kept: (keyof AvatarTraits)[] }
  | { status: "not_found" | "limit" | "no_model" | "unreadable" | "invalid" };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Foto nova vira traços novos. Se o modelo falha ou recusa, nada muda. */
export function redoAvatar(deps: RedoAvatarDeps) {
  return async (input: { orgId: string; personId: string; actorId: string; photo: { mediaType: PhotoType; base64: string } }): Promise<RedoOutcome> => {
    const started = Date.now();
    const record = (result: "ok" | "fallback" | "refused" | "failed" | "skipped", extra: { error?: string; model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number } = {}) =>
      deps.recorder.record({ flow: "avatar_redo", orgId: input.orgId, durationMs: Date.now() - started, result, ...extra });

    const current = await deps.store.current(input.orgId, input.personId);
    if (!current) return { status: "not_found" };
    if (!deps.vision) {
      await record("skipped", { error: "sem chave da Anthropic" });
      return { status: "no_model" };
    }
    // Limite antes do modelo: passou dele, não gasta nada.
    const now = (deps.clock ?? systemClock).now();
    if ((await deps.store.recentRedos(input.orgId, new Date(now.getTime() - 3_600_000))) >= REDO_LIMIT.perHour) {
      await record("skipped", { error: "limite de refações por hora" });
      return { status: "limit" };
    }

    try {
      const r = await readPhoto(deps.vision, input.photo, current, deps.timeoutMs ?? 30_000);
      const stats = { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd };
      if (r.rejected.includes("recusa")) {
        await record("refused", { ...stats, error: "o modelo recusou ler a foto" });
        return { status: "unreadable" };
      }
      // Nada na lista: a foto não serviu, e o bonequinho fica como estava.
      if (r.rejected.length === Object.keys(AVATAR_LISTS).length) {
        await record("fallback", { ...stats, error: "nenhum traço da lista" });
        return { status: "unreadable" };
      }
      const ok = await deps.store.update(input.orgId, input.personId, r.traits, input.actorId, "avatar:refazer");
      if (!ok) return { status: "not_found" };
      await record(r.rejected.length ? "fallback" : "ok", { ...stats, ...(r.rejected.length ? { error: `traços fora da lista: ${r.rejected.join(", ")}` } : {}) });
      return { status: "saved", traits: r.traits, kept: r.rejected as (keyof AvatarTraits)[] };
    } catch (err) {
      await record("failed", { model: MODELS.avatar, error: message(err) });
      return { status: "unreadable" };
    }
  };
}

/** Ajuste à mão: só valores da lista fechada; qualquer campo fora dela recusa o pedido inteiro. Sem modelo. */
export function adjustAvatar(deps: Pick<RedoAvatarDeps, "store" | "recorder">) {
  return async (input: { orgId: string; personId: string; actorId: string; traits: unknown }): Promise<RedoOutcome> => {
    const started = Date.now();
    const current = await deps.store.current(input.orgId, input.personId);
    if (!current) return { status: "not_found" };
    const { traits, rejected } = parseAvatarTraits(input.traits, current);
    if (rejected.length) return { status: "invalid" };
    const ok = await deps.store.update(input.orgId, input.personId, traits, input.actorId, "avatar:ajustar");
    if (!ok) return { status: "not_found" };
    await deps.recorder.record({ flow: "avatar_adjust", orgId: input.orgId, durationMs: Date.now() - started, result: "ok" });
    return { status: "saved", traits, kept: [] };
  };
}
