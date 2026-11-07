import type { Person } from "@echo/domain";
import { DEMO_PERSON_IDS } from "./agent";
import { findMember } from "./demo/team";
import type { Persona } from "./demo/types";

const DEMO_BY_DB_ID = new Map(Object.entries(DEMO_PERSON_IDS).map(([demo, db]) => [db, demo]));

/** Pessoa do banco no formato das telas. A do seed reaproveita o bonequinho da persona da demo. */
export function panelPersona(p: Pick<Person, "id" | "name"> & Partial<Person>): Persona {
  const demoId = DEMO_BY_DB_ID.get(p.id);
  const demo = demoId ? findMember(demoId) : undefined;
  if (demo) return { ...demo, name: p.name };
  return {
    id: p.id,
    orgId: p.orgId ?? "",
    name: p.name,
    role: p.role ?? "member",
    ...(p.teamId ? { teamId: p.teamId } : {}),
    timezone: p.timezone ?? "UTC",
    workHours: p.workHours ?? { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
    skills: p.skills ?? [],
    areas: p.areas ?? [],
    active: p.active ?? true,
    title: "",
    story: "",
    city: "",
    cityCode: "",
    availability: { kind: "working" },
  };
}
