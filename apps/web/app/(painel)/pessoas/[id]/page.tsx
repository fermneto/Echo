import { notFound } from "next/navigation";
import { canAskTwin } from "@/lib/access";
import { DEMO_NOW, findPersona } from "@/lib/demo/personas";
import { suggestedQuestions } from "@/lib/demo/twin";
import { requireAccess } from "@/lib/session";
import { localTime } from "@/lib/time";
import { HolderPanel, StatusChip } from "@/components/Status";
import { AskTwin } from "./AskTwin";

export default async function PessoaPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAccess("pessoa");
  const persona = findPersona((await params).id);
  if (!persona) notFound();

  return (
    <div className="split">
      <div className="split__text">
        <p className="mono muted">
          {persona.cityCode} {localTime(DEMO_NOW, persona.timezone)}
        </p>
        <h1 className="app-title">{persona.name}</h1>
        <p className="lead">
          {persona.title} em {persona.city}
        </p>
        <StatusChip persona={persona} />

        <HolderPanel persona={persona} />

        <dl className="module facts">
          <div>
            <dt className="mono muted">EXPEDIENTE</dt>
            <dd className="mono">
              {persona.workHours.start}–{persona.workHours.end} {persona.cityCode}
            </dd>
          </div>
          <div>
            <dt className="mono muted">FUSO</dt>
            <dd className="mono">{persona.timezone}</dd>
          </div>
          <div>
            <dt className="mono muted">ÁREAS</dt>
            <dd>{persona.areas.length > 0 ? persona.areas.join(", ") : "Sem área definida"}</dd>
          </div>
        </dl>
      </div>

      <div className="split__object">
        {canAskTwin(me.role) ? (
          <AskTwin personId={persona.id} personName={persona.name} askerName={me.name} suggestions={suggestedQuestions(persona)} />
        ) : (
          <p className="module note muted">O RH vê disponibilidade e contexto, mas não lê notas, tarefas nem perguntas.</p>
        )}
      </div>
    </div>
  );
}
