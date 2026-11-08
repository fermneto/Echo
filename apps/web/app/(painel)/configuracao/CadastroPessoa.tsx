"use client";

import { type FormEvent, useActionState, useEffect, useRef, useTransition } from "react";
import { PixelSprite } from "@/components/PixelSprite";
import Link from "next/link";
import { AccountFields } from "@/components/AccountFields";
import { type CadastroState, PHOTO_ACCEPT, RESUME_ACCEPT, ROLE_OPTIONS, ZONES } from "@/lib/onboarding-options";

const DAYS = [
  { n: 1, label: "Seg" },
  { n: 2, label: "Ter" },
  { n: 3, label: "Qua" },
  { n: 4, label: "Qui" },
  { n: 5, label: "Sex" },
  { n: 6, label: "Sáb" },
  { n: 0, label: "Dom" },
];

/** Cadastro pelo RH: dados do expediente, foto e currículo. O resultado mostra o bonequinho e o contexto lido. */
export function CadastroPessoa({ action, teams, slackMembers = null }: { action: (prev: CadastroState, form: FormData) => Promise<CadastroState>; teams: readonly { id: string; name: string }[]; slackMembers?: readonly { id: string; name: string }[] | null }) {
  const [state, submit, pending] = useActionState(action, { status: "idle" } as CadastroState);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  // Envio sem o `action` do form: o React limparia tudo (foto e currículo também) a cada erro. Limpa só quando cadastra.
  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => submit(data));
  };
  useEffect(() => {
    if (state.status === "done" && state.saved) formRef.current?.reset();
  }, [state]);

  return (
    <div className="onboard">
      <form ref={formRef} onSubmit={send} className="onboard__form">
        <label className="onboard__field onboard__field--wide">
          <span className="field-row__k">Nome</span>
          <input className="field" name="nome" required maxLength={80} autoComplete="off" />
        </label>
        <label className="onboard__field">
          <span className="field-row__k">Papel</span>
          <select className="field" name="papel" defaultValue="member">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="onboard__field">
          <span className="field-row__k">Equipe</span>
          <select className="field" name="equipe" defaultValue={teams[0]?.id ?? ""}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="">Sem equipe (só para o papel RH)</option>
          </select>
        </label>
        <label className="onboard__field">
          <span className="field-row__k">Fuso</span>
          <select className="field" name="fuso" defaultValue="America/Sao_Paulo">
            {ZONES.map((z) => (
              <option key={z.tz} value={z.tz}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="onboard__field onboard__field--wide onboard__days">
          <legend className="field-row__k">Expediente</legend>
          <div className="onboard__days-row">
            {DAYS.map((d) => (
              <label key={d.n} className="onboard__day">
                <input type="checkbox" name="dias" value={d.n} defaultChecked={d.n >= 1 && d.n <= 5} />
                <span>{d.label}</span>
              </label>
            ))}
            <input className="field onboard__hour" type="time" name="inicio" defaultValue="09:00" aria-label="Início do expediente" />
            <span className="muted">às</span>
            <input className="field onboard__hour" type="time" name="fim" defaultValue="18:00" aria-label="Fim do expediente" />
          </div>
        </fieldset>
        <fieldset className="onboard__field onboard__field--wide onboard__accounts">
          <legend className="field-row__k">Contas nas plataformas</legend>
          <p className="muted onboard__hint">É pela conta do Slack que a pessoa entra no painel, é reconhecida nas menções e recebe o privado do Echo. GitHub e Linear ligam os PRs e as tarefas a ela.</p>
          <div className="onboard__accounts-row">
            <AccountFields slackMembers={slackMembers} />
          </div>
        </fieldset>
        <label className="onboard__field">
          <span className="field-row__k">Foto</span>
          <input className="field onboard__file" type="file" name="foto" accept={PHOTO_ACCEPT} />
        </label>
        <label className="onboard__field">
          <span className="field-row__k">Currículo (PDF, .txt ou .md)</span>
          <input className="field onboard__file" type="file" name="curriculo" accept={RESUME_ACCEPT} />
        </label>
        <label className="onboard__field onboard__field--wide">
          <span className="field-row__k">Ou cole o texto do currículo</span>
          <textarea className="field onboard__text" name="curriculo_texto" rows={4} maxLength={12000} />
        </label>
        <div className="onboard__actions onboard__field--wide">
          <button type="submit" className="button-app-primary" disabled={pending}>
            {pending ? "Montando o gêmeo…" : "Cadastrar"}
          </button>
          {state.status === "error" ? (
            <p className="onboard__error" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>
      </form>

      <aside className="onboard__result" aria-live="polite">
        {state.status === "done" ? (
          <>
            <div className="onboard__stage">
              <PixelSprite look={state.avatar} mode="person" size={132} label={`Bonequinho de ${state.name}`} />
            </div>
            <p className="onboard__name">
              {state.personId ? <Link href={`/pessoas/${state.personId}`}>{state.name}</Link> : state.name}
            </p>
            <p className="mono muted onboard__title">{state.jobTitle ?? "Cargo a preencher"}</p>
            {state.skills.length || state.areas.length || state.languages.length ? (
              <ul className="chips onboard__chips" role="list">
                {[...state.skills, ...state.areas, ...state.languages].map((s) => (
                  <li key={s} className="chip">
                    {s}
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="onboard__notes" role="list">
              {state.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="onboard__stage onboard__stage--empty">
            <PixelSprite look={EMPTY_LOOK} mode="twin" size={132} />
            <p className="muted onboard__hint">O bonequinho aparece aqui, o mesmo que vai responder no Slack.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

const EMPTY_LOOK = { hair: "short", hairColor: "gray", skin: "s3", eyewear: "none", facialHair: "none", top: "tshirt", topColor: "gray", headwear: "none" } as const;
