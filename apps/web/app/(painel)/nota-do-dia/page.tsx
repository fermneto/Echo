import { dayMonth } from "@/lib/daily-note";
import { readNote } from "@/lib/daily-note-store";
import { requireAccess } from "@/lib/session";
import { gerarRascunho } from "./actions";
import { NoteEditor } from "./NoteEditor";
import "./nota-do-dia.css";

export const metadata = { title: "Nota do dia · Echo" };

/** Nota do dia (etapa 8): só a própria pessoa vê, edita e confirma. */
export default async function NotaDoDiaPage({ searchParams }: { searchParams: Promise<{ sem?: string }> }) {
  const me = await requireAccess("notaDoDia");
  const { view, mode, canDraft } = await readNote(me);
  const reason = (await searchParams).sem;
  const first = me.name.split(/\s+/)[0] ?? me.name;

  return (
    <>
      <h1 className="hero-title hero-title--page">Nota do dia</h1>
      <p className="lead">
        No fim do expediente, o seu agente escreve onde você parou. Confira, corrija e confirme: é com esta nota que ele responde quando você não está.
      </p>
      {view?.previous && <p className="note muted">Ainda não há nota de hoje. Continua valendo a nota de {dayMonth(view.date)}.</p>}
      {canDraft && (
        <form action={gerarRascunho} className="note-draft">
          <button type="submit" className="button-pill">
            Gerar o rascunho de hoje
          </button>
          <span className="muted">O agente escreve a partir do GitHub e do Linear, e avisa no Slack.</span>
        </form>
      )}
      {view ? (
        <NoteEditor key={`${view.date}-${view.state}`} initial={view} ownerName={first} branchFormat={mode === "db"} />
      ) : (
        <p className="note muted">
          {reason === "sem evento nas últimas 24 horas" ? "Sem atividade nas últimas 24 horas no GitHub ou no Linear, então o agente não escreveu rascunho." : "Ainda não há nota do dia."}
        </p>
      )}
    </>
  );
}
