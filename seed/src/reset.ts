// Apaga e recria SÓ a empresa de demonstração, numa transação. Outras empresas não são tocadas.
import { asSystem, type Database, schema } from "@echo/db";
import { eq, inArray } from "drizzle-orm";
import { buildDemo, DEMO_IDS, type DemoData } from "./demo.ts";

export interface ResetSummary {
  orgId: string;
  counts: Record<string, number>;
}

export async function resetDemo(db: Database, now: Date = new Date(), data: DemoData = buildDemo(now)): Promise<ResetSummary> {
  // Sistema: o seed apaga e recria uma empresa inteira, antes de existir contexto de empresa.
  return asSystem(db, async (tx) => {
    const demoOrgs = await tx.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.isDemo, true));
    const ids = [...new Set([...demoOrgs.map((o) => o.id), DEMO_IDS.org])];

    // Tabelas sem chave estrangeira para orgs não somem no cascade.
    await tx.delete(schema.installationRoutes).where(inArray(schema.installationRoutes.orgId, ids));
    await tx.delete(schema.inboxEvents).where(inArray(schema.inboxEvents.orgId, ids));
    // O resto sai em cascata a partir de orgs.
    await tx.delete(schema.orgs).where(inArray(schema.orgs.id, ids));

    await tx.insert(schema.orgs).values(data.orgs);
    await tx.insert(schema.teams).values(data.teams);
    await tx.insert(schema.people).values(data.people);
    await tx.insert(schema.identities).values(data.identities);
    if (data.absences.length) await tx.insert(schema.absences).values(data.absences);
    await tx.insert(schema.tasks).values(data.tasks);
    await tx.insert(schema.pullRequests).values(data.pullRequests);
    await tx.insert(schema.dailyNotes).values(data.dailyNotes);
    const notes = await tx.insert(schema.brainNotes).values(data.brainNotes).returning({
      id: schema.brainNotes.id,
      orgId: schema.brainNotes.orgId,
      content: schema.brainNotes.content,
      personId: schema.brainNotes.personId,
    });
    await tx.insert(schema.brainNoteVersions).values(
      notes.map((n) => ({ orgId: n.orgId, noteId: n.id, version: 1, content: n.content, authorId: n.personId, authorKind: "person" })),
    );
    await tx.insert(schema.workEvents).values(data.workEvents);
    await tx.insert(schema.contributions).values(data.contributions);
    await tx.insert(schema.questions).values(data.questions);
    await tx.insert(schema.agentRuns).values(data.agentRuns);
    await tx.insert(schema.auditLog).values({ orgId: DEMO_IDS.org, actor: "seed", action: "demo.reset", target: `org:${DEMO_IDS.org}` });

    return {
      orgId: DEMO_IDS.org,
      counts: {
        pessoas: data.people.length,
        tarefas: data.tasks.length,
        prs: data.pullRequests.length,
        notasDoDia: data.dailyNotes.length,
        notasDoCerebro: data.brainNotes.length,
        eventos: data.workEvents.length,
        ajudas: data.contributions.length,
        perguntas: data.questions.length,
        execucoes: data.agentRuns.length,
        equipes: data.teams.length,
        ferias: data.absences.length,
      },
    };
  });
}
