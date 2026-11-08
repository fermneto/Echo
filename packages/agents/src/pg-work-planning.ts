// Postgres da distribuição e da agenda: os dias escolhidos pela pessoa e a tarefa sem tracker.
import { asSystem, type Database, identities, installationRoutes, people, tasks, withOrg } from "@echo/db";
import { and, eq } from "drizzle-orm";
import type { WorkPlanningStore } from "./work-planning.ts";

export function createPgWorkPlanningStore(db: Database, orgId: string): WorkPlanningStore {
  return {
    async pins(personId) {
      const [r] = await withOrg(db, orgId, (tx) => tx.select({ pins: people.schedulePins }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId))));
      return r?.pins ?? {};
    },
    async setPins(personId, pins) {
      await withOrg(db, orgId, (tx) => tx.update(people).set({ schedulePins: pins }).where(and(eq(people.orgId, orgId), eq(people.id, personId))));
    },
    async assignLocalTask(taskId, toId) {
      await withOrg(db, orgId, (tx) => tx.update(tasks).set({ assigneeId: toId, updatedAt: new Date() }).where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId))));
    },
    async hasSlack(personId) {
      const [r] = await withOrg(db, orgId, (tx) => tx.select({ id: identities.externalId }).from(identities).where(and(eq(identities.orgId, orgId), eq(identities.personId, personId), eq(identities.platform, "slack"))));
      return Boolean(r);
    },
    async trackerAccounts() {
      // Mesma prioridade da ligação: com Linear na empresa, vale o Linear; o Jira só vale sozinho.
      const routes = await asSystem(db, (tx) => tx.select({ kind: installationRoutes.kind }).from(installationRoutes).where(eq(installationRoutes.orgId, orgId)));
      const kinds = new Set(routes.map((r) => r.kind));
      const platform = !kinds.has("linear") && kinds.has("jira") ? "jira" : "linear";
      const rows = await withOrg(db, orgId, (tx) => tx.select({ id: identities.personId }).from(identities).where(and(eq(identities.orgId, orgId), eq(identities.platform, platform))));
      return new Set(rows.map((r) => r.id));
    },
  };
}
