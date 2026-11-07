// Nota do produto (etapa 5): `processos/como-o-echo-funciona.md`, criada pelo worker ao iniciar
// em toda empresa que ainda não a tem. Nunca sobrescreve: se alguém editou, a edição fica.
import { asSystem, brainNotes, type Database, orgs } from "@echo/db";
import { eq } from "drizzle-orm";
import { createPgBrainStore } from "./pg.ts";

export const PRODUCT_NOTE_PATH = "processos/como-o-echo-funciona.md";

export const PRODUCT_NOTE = `# Como o Echo funciona

Cada pessoa da equipe tem um agente que conhece o trabalho dela. Ele responde quando ela está ausente,
sempre como "Agente de <nome>", nunca na primeira pessoa, e sempre com a fonte.

- O que está no GitHub e no Linear é checado ao vivo. Sem fonte, o agente diz que não sabe.
- Só a pessoa declara o que está liberado ou reservado, na nota do dia. Nota não conferida não libera nada.
- Números (carga, entregas, ajudas, custo) vêm de regras fixas, nunca do modelo.
- O agente não aprova PR, não muda tarefas e não avalia pessoas. Mudanças passam por aprovação de alguém.
- A correção humana vence: o agente não sobrescreve \`correcoes/\`.
- O RH não lê cérebros, notas do dia, tarefas nem perguntas.
`;

/** Cria a nota do produto nas empresas que ainda não a têm. Devolve quantas foram criadas. */
export async function ensureProductNote(db: Database): Promise<number> {
  const missing = await asSystem(db, async (tx) => {
    const all = await tx.select({ id: orgs.id }).from(orgs);
    const has = new Set((await tx.select({ orgId: brainNotes.orgId }).from(brainNotes).where(eq(brainNotes.path, PRODUCT_NOTE_PATH))).map((r) => r.orgId));
    return all.map((o) => o.id).filter((id) => !has.has(id));
  });
  for (const orgId of missing) {
    await createPgBrainStore(db, orgId).write(
      { kind: "agent" },
      { orgId, path: PRODUCT_NOTE_PATH, kind: "processo", content: PRODUCT_NOTE, visibility: "team", managedByRule: false },
    );
  }
  return missing.length;
}
