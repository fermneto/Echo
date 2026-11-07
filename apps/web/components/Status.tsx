import type { Persona } from "@/lib/demo/types";

/** Etiqueta de estado: no expediente, com o agente ou em férias. */
export function StatusChip({ persona }: { persona: Persona }) {
  const a = persona.availability;
  const [tone, label] =
    a.kind === "working" ? (["on", "No expediente"] as const) : a.kind === "off" ? (["twin", "Com o agente"] as const) : (["wait", `Férias até ${a.until}`] as const);
  return (
    <span className="status-tag mono">
      <span className={`dot dot--${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Quem está com o trabalho agora: a pessoa ou o agente dela. */
export function HolderPanel({ persona }: { persona: Persona }) {
  const a = persona.availability;
  const withPerson = a.kind === "working";
  return (
    <div className={`holder holder--${withPerson ? "person" : "twin"}`} role="status">
      <span className="mono holder__label">{withPerson ? "TRABALHO COM A PESSOA" : "TRABALHO COM O AGENTE"}</span>
      <span className="holder__text">
        {withPerson
          ? `${persona.name} está no expediente e responde por si.`
          : a.kind === "off"
            ? `Agente de ${persona.name} responde. ${persona.name} volta ${a.returns}.`
            : `Agente de ${persona.name} responde. Férias até ${a.until}.`}
      </span>
    </div>
  );
}
