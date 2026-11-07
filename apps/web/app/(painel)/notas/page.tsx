import { latest } from "@/lib/demo/notes";
import { findMember } from "@/lib/demo/team";
import { currentNotes } from "@/lib/notes-store";
import { teamScope } from "@/lib/scope";
import { requireAccess } from "@/lib/session";
import { PixelAvatar } from "@/components/PixelAvatar";
import { NoteCard } from "./NoteCard";

export const metadata = { title: "Notas · Echo" };

const FOLDER = { decisoes: "decisoes/", "nao-mexer": "nao-mexer.md", registros: "registros/" } as const;

export default async function NotasPage() {
  const me = await requireAccess("notas");
  // Só as notas de quem é da equipe da pessoa (o RH nem chega a esta tela).
  const visible = new Set((await teamScope(me)).people.map((p) => p.id));
  const notes = (await currentNotes()).filter((n) => visible.has(n.ownerId));
  const owners = [...new Set(notes.map((n) => n.ownerId))];

  return (
    <>
      <h1 className="hero-title hero-title--page">Notas</h1>
      <p className="lead">O que cada gêmeo sabe, com versões e fontes. Cada pessoa corrige as próprias notas, e a próxima resposta já cita a versão nova: a correção humana sempre vence.</p>
      <div className="brain-grid">
        {owners.map((id) => {
          const p = findMember(id)!;
          const mine = notes.filter((n) => n.ownerId === id);
          return (
            <section key={id} className="card brain" aria-labelledby={`cerebro-${id}`}>
              <header className="brain__who">
                <PixelAvatar persona={p} size={32} decorative />
                <h2 id={`cerebro-${id}`} className="card__title brain__name">
                  Notas de {p.name}
                </h2>
                <span className="mono muted brain__count">
                  {mine.length} {mine.length === 1 ? "nota" : "notas"}
                </span>
              </header>
              <ul className="brain__notes" role="list">
                {mine.map((n) => (
                  <li key={`${n.id}@${latest(n).n}`}>
                    <NoteCard note={n} path={`${p.name.toLowerCase()}/${FOLDER[n.folder]}`} canEdit={n.ownerId === me.id} />
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
