import { latest } from "@/lib/demo/notes";
import { findMember } from "@/lib/demo/team";
import type { Persona } from "@/lib/demo/types";
import { panelDb } from "@/lib/db";
import { MAX_BRAIN_NOTE } from "@/lib/notes";
import { loadNotes } from "@/lib/notes-db";
import { currentNotes } from "@/lib/notes-store";
import { panelPersona } from "@/lib/panel-person";
import { requireAccess } from "@/lib/session";
import { PixelAvatar } from "@/components/PixelAvatar";
import { SearchFilter } from "@/components/SearchFilter";
import { NoteCard } from "./NoteCard";
import "./notas.css";

export const metadata = { title: "Notas · Echo" };
export const dynamic = "force-dynamic";

const FOLDER = { decisoes: "decisoes/", "nao-mexer": "nao-mexer.md", registros: "registros/" } as const;

const LEAD = "O que cada gêmeo sabe, com versões e fontes. Cada pessoa corrige as próprias notas, e a próxima resposta já cita a versão nova: a correção humana sempre vence.";

/** Notas de uma dona: cabeçalho com o bonequinho e a contagem, e uma nota por linha. */
function Brain({ id, persona, name, count, children }: { id: string; persona?: Persona; name: string; count: number; children: React.ReactNode }) {
  return (
    <section className="card brain" aria-labelledby={`cerebro-${id}`} data-search-group>
      <header className="brain__who">
        {persona ? <PixelAvatar persona={persona} size={32} decorative /> : null}
        <h2 id={`cerebro-${id}`} className="card__title brain__name">
          Notas de {name}
        </h2>
        <span className="mono muted brain__count">
          {count} {count === 1 ? "nota" : "notas"}
        </span>
      </header>
      <ul className="brain__notes" role="list">
        {children}
      </ul>
    </section>
  );
}

export default async function NotasPage() {
  const me = await requireAccess("notas");
  const db = panelDb();

  if (db) {
    const groups = await loadNotes(db, me);
    return (
      <>
        <h1 className="hero-title hero-title--page">Notas</h1>
        <p className="lead">{LEAD}</p>
        {groups.length === 0 ? (
          <p className="note muted">Nenhuma nota visível para você ainda. Elas aparecem conforme os gêmeos registram decisões e você ou a equipe escrevem.</p>
        ) : (
          <SearchFilter label="Buscar notas" placeholder="Buscar por título, texto, etiqueta ou pessoa" empty="Nenhuma nota encontrada com essa busca.">
          <div className="brain-grid">
            {groups.map((g) => (
              <Brain key={g.ownerId ?? "equipe"} id={g.ownerId ?? "equipe"} name={g.ownerId ? g.name : "toda a empresa"} count={g.notes.length} {...(g.ownerId ? { persona: panelPersona({ id: g.ownerId, name: g.name }) } : {})}>
                {g.notes.map((n) => (
                  <li key={`${n.id}@${latest(n).n}`} data-search={`${n.title} ${latest(n).body} ${n.tags.join(" ")} ${g.name}`}>
                    <NoteCard note={n} path={n.path} canEdit={n.canEdit} maxLength={MAX_BRAIN_NOTE} />
                  </li>
                ))}
              </Brain>
            ))}
          </div>
          </SearchFilter>
        )}
      </>
    );
  }

  const notes = await currentNotes();
  const owners = [...new Set(notes.map((n) => n.ownerId))];
  return (
    <>
      <h1 className="hero-title hero-title--page">Notas</h1>
      <p className="lead">{LEAD}</p>
      <SearchFilter label="Buscar notas" placeholder="Buscar por título, texto, etiqueta ou pessoa" empty="Nenhuma nota encontrada com essa busca.">
      <div className="brain-grid">
        {owners.map((id) => {
          const p = findMember(id)!;
          const mine = notes.filter((n) => n.ownerId === id);
          return (
            <Brain key={id} id={id} persona={p} name={p.name} count={mine.length}>
              {mine.map((n) => (
                <li key={`${n.id}@${latest(n).n}`} data-search={`${n.title} ${latest(n).body} ${n.tags.join(" ")} ${p.name}`}>
                  <NoteCard note={n} path={`${p.name.toLowerCase()}/${FOLDER[n.folder]}`} canEdit={n.ownerId === me.id} />
                </li>
              ))}
            </Brain>
          );
        })}
      </div>
      </SearchFilter>
    </>
  );
}
