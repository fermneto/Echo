"use client";

import { useActionState } from "react";
import { entrarComSenha, type EntrarState } from "./actions";

/** Usuário e senha da demonstração. O erro aparece no formulário, sem dizer qual dos dois falhou. */
export function LoginForm({ defaultUsername }: { defaultUsername?: string }) {
  const [state, action, pending] = useActionState<EntrarState, FormData>(entrarComSenha, {});
  return (
    <form action={action} className="entrar__form login-form">
      <label className="login-form__field">
        <span className="login-form__label mono">Usuário</span>
        <input className="field" name="usuario" autoComplete="username" autoCapitalize="none" spellCheck={false} required defaultValue={state.username ?? defaultUsername ?? ""} aria-invalid={state.error ? true : undefined} />
      </label>
      <label className="login-form__field">
        <span className="login-form__label mono">Senha</span>
        <input className="field" name="senha" type="password" autoComplete="current-password" required aria-invalid={state.error ? true : undefined} />
      </label>
      {state.error ? (
        <p className="login-form__error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="button-pill entrar__submit" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
