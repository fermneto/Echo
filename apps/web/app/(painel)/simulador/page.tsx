import { canAskTwin } from "@/lib/access";
import { panelDb } from "@/lib/db";
import { ECHO_SUGGESTIONS } from "@/lib/demo/echo";
import { findMember, TEAM } from "@/lib/demo/team";
import { suggestedQuestions } from "@/lib/demo/twin";
import { ECHO_TARGET, mentionTargets } from "@/lib/simulator";
import { requireAccess } from "@/lib/session";
import { Channel } from "./Channel";
import "./simulador.css";

export const metadata = { title: "Simulador · Echo" };

/** Simulador (etapa 16, só na demonstração): um canal do Slack que passa pelo mesmo fluxo de resposta. */
export default async function SimuladorPage() {
  const me = await requireAccess("simulador");
  const targets = mentionTargets(TEAM, me.id);
  const people = Object.fromEntries(TEAM.map((p) => [p.id, p]));
  const suggestions: Record<string, string[]> = Object.fromEntries(
    targets.map((t) => [t.id, t.id === ECHO_TARGET ? ECHO_SUGGESTIONS.slice(0, 3) : suggestedQuestions(findMember(t.id)!)]),
  );
  const real = panelDb() !== null;

  return (
    <>
      <h1 className="hero-title hero-title--page">Simulador</h1>
      <p className="lead">
        Mencione o agente de um colega ou o Echo, como no canal da equipe. O agente sempre se identifica, cita as fontes e nunca fala como a pessoa.
      </p>
      <p className="status-tag mono sim__mode">
        <span className={`dot ${real ? "dot--on" : "dot--off"}`} aria-hidden="true" />
        {real ? "Respostas do fluxo real, com os dados da empresa" : "Respostas simuladas: o painel ainda não tem banco ligado"}
      </p>
      <Channel me={findMember(me.id) ?? me} people={people} targets={targets} suggestions={suggestions} canAsk={canAskTwin(me.role)} />
    </>
  );
}
