import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { canAskTwin, canEditProfile } from "@/lib/access";
import { profileFor } from "@/lib/demo/profiles";
import { suggestedQuestions } from "@/lib/demo/twin";
import { latest } from "@/lib/demo/notes";
import { currentNotes } from "@/lib/notes-store";
import { teamScope } from "@/lib/scope";
import { requireAccess } from "@/lib/session";
import { loadTeam } from "@/lib/team-live";
import { localTime } from "@/lib/time";
import { AskPanel } from "@/components/AskPanel";
import { PixelAvatar } from "@/components/PixelAvatar";
import { HolderPanel, StatusChip } from "@/components/Status";
import { RailTrack } from "@/components/TimeRail";
import { AgentProfileForm } from "@/components/AgentProfileForm";
import { AGENT_PROFILE_RULES, NEVER_DELEGATED } from "@echo/domain";
import { loadOwnAgent } from "@/lib/agent-profile-store";
import { panelDb } from "@/lib/db";
import { perguntar, salvarPerfil, salvarPerfilDoAgente } from "./actions";
import { EditarPerfil } from "./EditarPerfil";

const DAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="chips" role="list">
      {items.map((i) => (
        <li key={i} className="chip mono">
          {i}
        </li>
      ))}
    </ul>
  );
}

function Field({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <p className="field-row__k mono">{k}</p>
      <div className="field-row__v">{children}</div>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((b) => (
        <li key={b}>{b}</li>
      ))}
    </ul>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const p = (await loadTeam(new Date())).find((x) => x.id === id);
  return { title: p ? `${p.name} · Echo` : "Pessoa · Echo" };
}

export default async function PessoaPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAccess("pessoa");
  const now = new Date();
  const id = (await params).id;
  const team = await loadTeam(now);
  const persona = team.find((p) => p.id === id);
  if (!persona) notFound();
  // Membro e liderança só abrem a ficha de quem é da própria equipe; o RH, das equipes que acompanha.
  if (!(await teamScope(me, team)).people.some((p) => p.id === persona.id)) notFound();
  const profile = profileFor(persona);
  const brain = (await currentNotes()).filter((n) => n.ownerId === persona.id);
  const notes = brain.length ? brain.map((n) => ({ title: n.title, excerpt: latest(n).body, tags: n.tags })) : profile.notes;
  const isMe = me.id === persona.id;
  const away = persona.availability.kind !== "working";
  const seesWork = canAskTwin(me.role);
  const own = isMe ? await loadOwnAgent(me, panelDb()) : null;
  // Só quem foi cadastrado no painel tem o perfil no banco; as personas da demo seguem com o perfil sintético.
  const editable = Boolean(persona.registered) && canEditProfile(me, persona);
  const emptyProfile = Boolean(persona.registered && !persona.jobTitle && persona.skills.length === 0);

  return (
    <>
      <Link href="/equipe" className="back-link mono">
        ← Pessoas
      </Link>

      <header className="profile-top">
        <figure className="profile-avatar">
          <PixelAvatar persona={persona} size={132} />
          <figcaption className="mono">{away ? `Gêmeo de ${persona.name} no comando` : `${persona.name} no expediente`}</figcaption>
        </figure>
        <div className="profile-top__text">
          <h1 className="app-title">{persona.name}</h1>
          <p className="lead">
            {persona.title || (persona.registered ? "Cargo a preencher" : "")}
          </p>
          <StatusChip persona={persona} />
        </div>
      </header>

      <div className="profile-grid">
        <div className="profile-col">
          {seesWork && (
            <section className="card" aria-labelledby="trabalho">
              <h2 id="trabalho" className="card__title">
                No que está trabalhando
              </h2>
              {profile.focus && (
                <Field k="Foco atual">
                  <p>{profile.focus}</p>
                </Field>
              )}
              {profile.work.length > 0 ? (
                <ul className="work-list" role="list">
                  {profile.work.map((w) => (
                    <li key={w.title}>
                      <p className="work-list__title">{w.title}</p>
                      <p className="work-list__meta mono">{w.meta}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{persona.registered ? "Nada registrado no GitHub ou no Linear ainda." : "Nada registrado no GitHub ou no Linear para esta pessoa na demo."}</p>
              )}
              {profile.activity && <p className="card__foot mono">{profile.activity}</p>}
            </section>
          )}

          {seesWork && profile.lastNote && (
            <section className="card" aria-labelledby="nota">
              <h2 id="nota" className="card__title">
                Última nota do dia ({profile.lastNote.date})
              </h2>
              <Field k="Parou em">
                <p>{profile.lastNote.stoppedAt}</p>
              </Field>
              <Field k="Travou">
                <List items={profile.lastNote.blocked} />
              </Field>
              <Field k="Liberado">
                <List items={profile.lastNote.released} />
              </Field>
              <Field k="Reservado">
                <List items={profile.lastNote.reserved} />
              </Field>
            </section>
          )}

          {seesWork && !isMe && (
            <section id="perguntar" className="ask-anchor">
              <AskPanel
                ask={perguntar}
                title={`Pergunte ao gêmeo de ${persona.name}`}
                footer={`É o mesmo agente que responde por ${persona.name} no Slack: só lê e cita a fonte. Quem decide é ${persona.name}.`}
                agent={`Agente de ${persona.name}`}
                ownerName={persona.name}
                hidden={{ pessoa: persona.id }}
                askerName={me.name}
                empty={`Pergunte sobre uma branch, uma tarefa ou quando ${persona.name} volta. O agente responde com o que ${persona.name} deixou registrado.`}
                placeholder={`Por exemplo: onde ${persona.name} parou?`}
                suggestions={suggestedQuestions(persona)}
              />
            </section>
          )}

          {own && (
            <section className="card" aria-labelledby="seu-agente">
              <h2 id="seu-agente" className="card__title">
                Seu agente
              </h2>
              <AgentProfileForm
                save={salvarPerfilDoAgente}
                personId={me.id}
                firstName={persona.name.split(" ")[0] ?? persona.name}
                style={own.style}
                delegation={own.delegation}
                delegationSince={own.delegationAt ? own.delegationAt.toLocaleDateString("pt-BR", { timeZone: persona.timezone }) : null}
                decisions={own.decisions}
                timezone={persona.timezone}
                maxChars={AGENT_PROFILE_RULES.maxChars}
                never={NEVER_DELEGATED}
                fixRules={`Mesmo com a delegação, a correção só é unida sozinha com testes passando, até ${AGENT_PROFILE_RULES.delegatedFixMaxFiles} arquivos, fora de autenticação, pagamentos, migrações e infraestrutura, e se o rascunho não mudou. Você recebe o aviso com o motivo e pode desfazer.`}
                demo={own.demo}
              />
            </section>
          )}

          {seesWork && notes.length > 0 && (
            <section className="card" aria-labelledby="notas">
              <h2 id="notas" className="card__title">
                Notas
              </h2>
              <ul className="note-list" role="list">
                {notes.map((n) => (
                  <li key={n.title}>
                    <p className="note-list__title">
                      <Link href="/notas">{n.title}</Link>
                    </p>
                    <p className="note-list__excerpt">{n.excerpt}</p>
                    <Chips items={n.tags} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!seesWork && <p className="card muted">O RH vê disponibilidade e contexto, mas não lê notas, tarefas nem perguntas.</p>}
        </div>

        <div className="profile-col">
          {editable && (
            <EditarPerfil
              action={salvarPerfil}
              personId={persona.id}
              initial={{ jobTitle: persona.jobTitle ?? null, skills: persona.skills, areas: persona.areas, languages: persona.languages ?? [] }}
              open={emptyProfile}
            />
          )}
          <HolderPanel persona={persona} />
          <section className="card" aria-labelledby="como">
            <h2 id="como" className="card__title">
              Como trabalha
            </h2>
            <Field k="Expediente">
              <p>
                {persona.workHours.start} às {persona.workHours.end}, {persona.workHours.days.map((d) => DAYS[d]).join(", ")}
              </p>
            </Field>
            <Field k="Fuso">
              <p>
                {persona.city}, agora são {localTime(now, persona.timezone)}
              </p>
              <div className="profile-rail">
                <p className="mono muted profile-rail__label">
                  <span>−12H</span>
                  <span>AGORA</span>
                  <span>+12H</span>
                </p>
                <RailTrack persona={persona} now={now} />
              </div>
            </Field>
            {profile.howToTalk && (
              <Field k="Como falar">
                <p>{profile.howToTalk}</p>
              </Field>
            )}
            {profile.whenAway && (
              <Field k="Na ausência">
                <p>{profile.whenAway}</p>
              </Field>
            )}
          </section>

          {profile.skills.length > 0 && (
            <section className="card" aria-labelledby="skills">
              <h2 id="skills" className="card__title">
                Habilidades
              </h2>
              {profile.skills.map((g) => (
                <Field key={g.label} k={g.label}>
                  <Chips items={g.items} />
                </Field>
              ))}
            </section>
          )}

          <section className="card" aria-labelledby="sobre">
            <h2 id="sobre" className="card__title">
              Sobre
            </h2>
            {profile.about && (
              <Field k="O que faz">
                <p>{profile.about}</p>
              </Field>
            )}
            <Field k="Áreas de atuação">{persona.areas.length > 0 ? <Chips items={persona.areas} /> : <p className="muted">Sem área definida</p>}</Field>
            {profile.tools.length > 0 && (
              <Field k="Ferramentas">
                <Chips items={profile.tools} />
              </Field>
            )}
            {profile.languages.length > 0 && (
              <Field k="Idiomas">
                <Chips items={profile.languages} />
              </Field>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
