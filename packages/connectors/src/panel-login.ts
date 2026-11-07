// Quem entrou pelo Slack é quem no Echo: espaço → empresa (installation_routes), pessoa → identities.
import { identities, people, withOrg, type Database } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { routeOrg } from "./inbox.ts";
import type { SlackIdentity } from "./slack-oidc.ts";

export interface PanelPerson {
  orgId: string;
  personId: string;
  name: string;
  role: "member" | "leader" | "hr";
}

export type PanelLogin = { ok: true; person: PanelPerson } | { ok: false; reason: "espaco_desconhecido" | "pessoa_nao_cadastrada" | "pessoa_inativa" };

export async function resolvePanelPerson(db: Database, id: SlackIdentity): Promise<PanelLogin> {
  const orgId = await routeOrg(db, "slack", id.teamId);
  if (!orgId) return { ok: false, reason: "espaco_desconhecido" };
  const [row] = await withOrg(db, orgId, (tx) =>
    tx
      .select({ personId: people.id, name: people.name, role: people.role, active: people.active })
      .from(identities)
      .innerJoin(people, eq(people.id, identities.personId))
      .where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack"), eq(identities.externalId, id.userId))),
  );
  if (!row) return { ok: false, reason: "pessoa_nao_cadastrada" };
  if (!row.active) return { ok: false, reason: "pessoa_inativa" };
  const role = row.role === "leader" || row.role === "hr" ? row.role : "member";
  return { ok: true, person: { orgId, personId: row.personId, name: row.name, role } };
}

/** Pessoa da sessão, lida de novo a cada página: desligamento ou troca de papel valem na hora. */
export async function loadPanelPerson(db: Database, orgId: string, personId: string) {
  const [row] = await withOrg(db, orgId, (tx) => tx.select().from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId), eq(people.active, true))));
  return row ?? null;
}
