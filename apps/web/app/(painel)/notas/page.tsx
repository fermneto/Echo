import { latest } from "@/lib/demo/notes";
import { findMember } from "@/lib/demo/team";
import { currentNotes } from "@/lib/notes-store";
import { requireAccess } from "@/lib/session";
import { PixelAvatar } from "@/components/PixelAvatar";
import { NoteCard } from "./NoteCard";

export const metadata = { title: "Notas · Echo" };

const FOLDER = { decisoes: "decisoes/", "nao-mexer": "nao-mexer.md", registros: "registros/" } as const;

export default async function NotasPage() {
  await requireAccess("notas");
  const notes = await currentNotes();
  const owners = [...new Set(notes.map((n) => n.ownerId))];

  return (
    <>
      <h1 className="hero-title hero-title--page">Notas</h1>
      <p className="lead">O que cada gêmeo sabe, com versões e fontes. Corrija uma nota e a próxima resposta já cita a versão nova: a correção humana sempre vence.</p>
      <div className="brain-grid">
        {owners.map((id) => {
          const p = findMember(id)!;
          const mine = notes.filter((n) => n.ownerId === id);
          return (
            <section key={id} className="card brain" aria-labelledby={`cerebro-${id}`}>
              <header className="brain__who">
                <PixelAvatar persona={p} size={32} decorative />
                <h2 id={`cerebro-${id}`} className="card__title brain__name">
                  Cérebro de {p.name}
                </h2>
                <span className="mono muted brain__count">
                  {mine.length} {mine.length === 1 ? "nota" : "notas"}
                </span>
              </header>
              <ul className="brain__notes" role="list">
                {mine.map((n) => (
                  <li key={`${n.id}@${latest(n).n}`}>
                    <NoteCard note={n} path={`${p.name.toLowerCase()}/${FOLDER[n.folder]}`} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
