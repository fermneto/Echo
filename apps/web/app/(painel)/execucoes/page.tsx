import { panelDb } from "@/lib/db";
import { latest } from "@/lib/demo/notes";
import { DAY_RUNS } from "@/lib/demo/runs";
import { currentDecisions } from "@/lib/decisions-store";
import { gainsOrgId } from "@/lib/gains";
import { currentNotes } from "@/lib/notes-store";
import { monthStart, runsBoardFromDb } from "@/lib/runs-db";
import { requireAccess } from "@/lib/session";
import { RunsBoard, type AuditEntry } from "./RunsBoard";

export const metadata = { title: "Custo e execuções · Echo" };
export const dynamic = "force-dynamic";

const LEAD = "Quanto custou cada fluxo e o rastro de cada execução. O custo sai dos tokens e da tabela de preços; o que sai por regra não usa modelo e custa zero.";
const LIMIT = 50;

const BASE_AUDIT: AuditEntry[] = [
  { at: "05/11 09:12", actor: "Fernando", action: "confirmou a nota do dia", target: "05/11" },
  { at: "04/11 18:30", actor: "Carla", action: "confirmou uma ajuda", target: "Bruno · ECH-133" },
];

export default async function ExecucoesPage() {
  const persona = await requireAccess("execucoes");
  const db = panelDb();

  if (db) {
    // Import tardio: só o leitor das execuções, sem o restante do servidor dos agentes.
    const { readOrgSettings, readRuns } = await import("@echo/agents/execucoes");
    const orgId = gainsOrgId(persona.orgId);
    const now = new Date();
    const [view, settings] = await Promise.all([readRuns(db, orgId, { monthStart: monthStart(now), limit: LIMIT }), readOrgSettings(db, orgId)]);
    const board = runsBoardFromDb(view, { timeZone: persona.timezone });
    return (
      <>
        <h1 className="hero-title hero-title--page">Custo e execuções</h1>
        <p className="lead">{LEAD}</p>
        <RunsBoard
          day={board.runs}
          audit={board.audit}
          spentBeforeUsd={board.spentBeforeUsd}
          {...(settings ? { limitUsd: settings.monthlyLimitUsd } : {})}
          periodLabel={board.runs.length >= LIMIT ? `Custo das últimas ${LIMIT} execuções` : "Custo das execuções listadas"}
        />
      </>
    );
  }

  const edits: AuditEntry[] = (await currentNotes())
    .filter((n) => n.versions.length > 1)
    .map((n) => ({ at: latest(n).at, actor: latest(n).by, action: "corrigiu a nota", target: `${n.title} (versão ${latest(n).n})` }));

  const decisions = await currentDecisions();
  const decided: AuditEntry[] = [
    ...(decisions["ech-160"] ? [{ at: decisions["ech-160"].at, actor: decisions["ech-160"].by, action: "atribuiu", target: "ECH-160 a Carla" }] : []),
    ...(decisions["ferias-bruno"] ? [{ at: decisions["ferias-bruno"].at, actor: decisions["ferias-bruno"].by, action: "aprovou o plano", target: "férias de Bruno (3 mudanças)" }] : []),
  ];

  return (
    <>
      <h1 className="hero-title hero-title--page">Custo e execuções</h1>
      <p className="lead">{LEAD}</p>
      <RunsBoard day={DAY_RUNS} audit={[...decided, ...edits, ...BASE_AUDIT]} />
    </>
  );
}
