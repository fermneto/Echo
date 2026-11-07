import Link from "next/link";
import type { Persona } from "@/lib/demo/types";
import { DEMO_NOW } from "@/lib/demo/personas";
import { localTime } from "@/lib/time";
import { StatusChip } from "./Status";

/** Retrato da equipe: nome, função, cidade com a hora local e o estado. */
export function PersonCard({ persona }: { persona: Persona }) {
  return (
    <Link href={`/pessoas/${persona.id}`} className="person-card">
      <span className={`avatar avatar--${persona.availability.kind}`} aria-hidden="true">
        {persona.name[0]}
      </span>
      <span className="person-card__name">{persona.name}</span>
      <span className="person-card__title">{persona.title}</span>
      <span className="mono muted">
        {persona.cityCode} {localTime(DEMO_NOW, persona.timeZone)}
      </span>
      <StatusChip persona={persona} />
    </Link>
  );
}
