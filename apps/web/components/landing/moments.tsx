import type { ReactNode } from "react";
import { lookFor } from "@/lib/demo/looks";
import { localTime } from "@/lib/time";
import { PixelSprite } from "../PixelSprite";
import type { StackItem } from "./CardStack";

/**
 * Momentos da história da demo (docs/produto.md), em ordem de horário, para o carrossel
 * "O Echo em ação". Dados SINTÉTICOS. Cada cartão mostra a hora nas três cidades naquele instante.
 */

const CITIES = [
  { code: "FOR", tz: "America/Fortaleza" },
  { code: "JNB", tz: "Africa/Johannesburg" },
  { code: "TYO", tz: "Asia/Tokyo" },
] as const;
type City = (typeof CITIES)[number]["code"];

function Clocks({ at, where, tone }: { at: string; where: City; tone: "on" | "twin" }) {
  const when = new Date(at);
  return (
    <div className="moment__clocks">
      {CITIES.map((c) => (
        <span key={c.code} className={`moment__clock${c.code === where ? ` is-here is-${tone}` : ""}`}>
          <span className="moment__city">{c.code}</span>
          <span className="moment__time">{localTime(when, c.tz)}</span>
        </span>
      ))}
    </div>
  );
}

function Moment({
  at,
  where,
  tone,
  who,
  twin,
  title,
  decides,
  children,
}: {
  at: string;
  where: City;
  tone: "on" | "twin";
  who: string;
  twin?: boolean | "away";
  title: string;
  decides: string;
  children: ReactNode;
}) {
  return (
    <article className="moment">
      <header className="moment__head">
        <span className="moment__actor">
          <PixelSprite look={lookFor(who)} mode={twin === "away" ? "away" : twin ? "twin" : "person"} size={30} />
          <span className="moment__title">{title}</span>
        </span>
        <span className="lp-pill">Exemplo</span>
      </header>
      <Clocks at={at} where={where} tone={tone} />
      <div className="moment__body">{children}</div>
      <footer className="moment__foot">
        <span className="lp-dot" aria-hidden="true" />
        {decides}
      </footer>
    </article>
  );
}

const Row = ({ k, v, tone }: { k: string; v: string; tone?: "on" | "wait" }) => (
  <p className="lp-row">
    <span>{k}</span>
    <span className={`lp-mono${tone ? ` lp-${tone}` : ""}`}>{v}</span>
  </p>
);

export const MOMENTS: StackItem[] = [
  {
    id: "nota",
    title: "18:00 em Fortaleza: Fernando fecha o dia e publica a nota",
    content: (
      <Moment at="2026-11-05T21:00:00Z" where="FOR" tone="on" who="fernando" title="Fernando fecha o dia" decides="Fernando confere e publica a nota">
        <Row k="ech-131-api-v2" v="LIBERADA" tone="on" />
        <Row k="ech-128-tempo-limite" v="RESERVADA" tone="wait" />
        <Row k="Parou em" v="cliente.ts" />
      </Moment>
    ),
  },
  {
    id: "ferias",
    title: "10:15 em Tóquio: Marina aprova o plano para as férias de Bruno",
    content: (
      <Moment at="2026-11-06T01:15:00Z" where="TYO" tone="on" who="marina" title="Marina redistribui as férias de Bruno" decides="Nada muda até a liderança aprovar">
        <Row k="ECH-133 → Carla" v="pagamentos, com folga" />
        <Row k="ECH-137 → Eduardo" v="escolhida pela folga" />
        <Row k="Revisão PR 36 → Fernando" v="mais folga" />
      </Moment>
    ),
  },
  {
    id: "pergunta",
    title: "03:12 em Fortaleza: o agente de Fernando responde a Eduardo, em Joanesburgo",
    content: (
      <Moment at="2026-11-06T06:12:00Z" where="FOR" tone="twin" who="fernando" twin title="Eduardo pergunta; Fernando dorme" decides="Eduardo decide se segue">
        <p>
          <b>Eduardo</b> @Fernando posso seguir com a ech-131-api-v2?
        </p>
        <p>
          <b className="lp-twin">Agente de Fernando</b> Sim: liberada na nota do dia confirmada. Fernando volta às 9h.
        </p>
        <span className="lp-source">Fonte: nota do dia (confirmada)</span>
      </Moment>
    ),
  },
  {
    id: "reservada",
    title: "03:15 em Fortaleza: a ech-128 fica reservada e vai para o plano da manhã",
    content: (
      <Moment at="2026-11-06T06:15:00Z" where="FOR" tone="twin" who="fernando" twin title="O agente não libera o que é reservado" decides="Fernando decide de manhã">
        <p>
          <b>Eduardo</b> e a ech-128-tempo-limite, posso mexer?
        </p>
        <p>
          <b className="lp-twin">Agente de Fernando</b> Não há liberação: reservada até a revisão do PR. A dúvida entra no plano da manhã.
        </p>
        <span className="lp-source">Fonte: nota do dia · PR da ech-128</span>
      </Moment>
    ),
  },
  {
    id: "yan",
    title: "16:02 em Tóquio: o agente de Yan, de férias, responde sobre a ECH-140",
    content: (
      <Moment at="2026-11-06T07:02:00Z" where="TYO" tone="twin" who="yan" twin="away" title="Yan está de férias; o agente cobre" decides="Ninguém chama quem está de férias">
        <p>
          <b>Eduardo</b> @Yan o ECH-140 já terminou?
        </p>
        <p>
          <b className="lp-twin">Agente de Yan</b> Em andamento no Linear agora, prazo na sexta. O PR ligado está aberto, sem revisão.
        </p>
        <span className="lp-source">Fonte: ECH-140 no Linear (ao vivo)</span>
      </Moment>
    ),
  },
  {
    id: "revisao",
    title: "05:40 em Fortaleza: a revisão noturna deixa uma correção pronta",
    content: (
      <Moment at="2026-11-06T08:40:00Z" where="FOR" tone="twin" who="fernando" twin title="Revisão noturna do PR 41" decides="Fernando aprova de manhã; nada foi aprovado">
        <pre className="lp-diff" aria-label="Diferença no código">
          <span className="lp-diff__del">− timeout: 30_000</span>
          <span className="lp-diff__add">+ timeout: 8_000</span>
        </pre>
        <p>Correção pronta numa versão separada.</p>
      </Moment>
    ),
  },
  {
    id: "plano",
    title: "08:45 em Fortaleza: o plano da manhã de Fernando está pronto",
    content: (
      <Moment at="2026-11-06T11:45:00Z" where="FOR" tone="on" who="fernando" title="Fernando acorda com o plano pronto" decides="Fernando confere e aprova">
        <Row k="Aprovar correção" v="PR 41" />
        <Row k="Responder Eduardo" v="ech-128" />
        <Row k="Revisar PR de Carla" v="PR 34" />
      </Moment>
    ),
  },
];
