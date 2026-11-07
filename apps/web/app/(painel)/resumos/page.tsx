import Link from "next/link";
import { dayMonth, STATE_LABEL } from "@/lib/daily-note";
import { readDaySummary } from "@/lib/day-summary";
import { requireAccess } from "@/lib/session";
import { SummaryBlocks } from "./Summary";
import "./resumos.css";

export const metadata = { title: "Resumo do dia · Echo" };

/** Resumo do dia (etapa 26): só a própria pessoa vê. Layout montado por um modelo aberto a partir de fatos. */
export default async function ResumosPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const me = await requireAccess("resumo");
  const { data } = await searchParams;
  const view = await readDaySummary(me, data);
  const first = me.name.split(/\s+/)[0] ?? me.name;

  if (!view) {
    return (
      <>
        <h1 className="hero-title hero-title--page">Resumo do dia</h1>
        <p className="note muted">Ainda não há nota do dia para resumir. O resumo sai junto com o rascunho do fim do expediente.</p>
        <Link href="/nota-do-dia" className="link-inline">
          Ir para a nota do dia
        </Link>
      </>
    );
  }
  const state = view.note ? STATE_LABEL[view.note.state] : null;
  return (
    <div className="summary">
      <div className="summary__top">
        <h1 className="hero-title hero-title--page">Resumo do dia, {dayMonth(view.date)}</h1>
        <div className="summary__badges">
          {state && <span className={`summary__status summary__status--${state.tone}`}>{state.label}</span>}
          <span className={view.model ? "summary__by" : "summary__by summary__by--rule"}>{view.model ? `Layout por ${modelName(view.model)} · modelo aberto` : "Layout padrão, por regra"}</span>
        </div>
      </div>
      <p className="lead">Feito pelo Agente de {first} a partir do GitHub, do Linear e da sua nota. Números e nomes vêm dos fatos, nunca do modelo.</p>
      <SummaryBlocks blocks={view.spec.blocks} day={view.day} />
      <p className="summary__links">
        <Link href={`/nota-do-dia`} className="link-inline">
          Conferir e editar a nota do dia
        </Link>
      </p>
    </div>
  );
}

function modelName(tag: string): string {
  if (tag.startsWith("qwen3:4b")) return "Qwen3 4B";
  if (tag.startsWith("qwen2.5-coder:1.5b")) return "Qwen2.5-Coder 1.5B";
  return tag;
}
