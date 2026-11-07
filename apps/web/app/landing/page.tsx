import type { CSSProperties } from "react";
import Link from "next/link";
import { EchoGlobe, type GlobeArc, type GlobePoint } from "@/components/landing/EchoGlobe";
import { DotField } from "@/components/landing/DotField";
import { IntegrationsMarquee } from "@/components/landing/integrations";
import { PixelSprite } from "@/components/PixelSprite";
import { lookFor } from "@/lib/demo/looks";
import { DEMO_NOW, PERSONAS } from "@/lib/demo/personas";
import { localTime } from "@/lib/time";
import "./landing.css";

export const metadata = {
  title: "Echo · O trabalho continua quando a pessoa não está",
  description: "Cada pessoa da equipe tem um gêmeo digital que responde quando ela dorme, revisa à noite e deixa o plano pronto de manhã.",
};

/* Conteúdo: docs/produto.md. Exemplos de produto são sintéticos e marcados como "Exemplo". */

const NIGHT = [
  { at: "18:00", tone: "on", who: "Fernando confere e publica" },
  { at: "03:12", tone: "twin", who: "Quem perguntou decide" },
  { at: "05:40", tone: "twin", who: "Fernando aprova de manhã" },
  { at: "08:45", tone: "on", who: "Fernando reordena e aprova" },
] as const;

const DAY = [
  { when: "Durante o dia", what: "Registro", text: "O gêmeo registra commits, PRs, tarefas e ajudas confirmadas.", who: "Ninguém: é só registro." },
  { when: "Pessoa citada e fora", what: "Resposta", text: "Responde colegas citando a fonte, sempre identificado como agente. O status é olhado na hora da menção e não fica guardado.", who: "Quem perguntou decide o que fazer." },
  { when: "Fim do expediente", what: "Nota do dia", text: "Rascunha onde a pessoa parou, o que travou, o que está liberado e o que está reservado.", who: "A pessoa confere e publica." },
  { when: "Noite", what: "Revisão", text: "Revisa os PRs em lote e deixa a correção pronta numa versão separada.", who: "O autor aprova de manhã." },
  { when: "Manhã", what: "Plano", text: "Aprovações, correções prontas, dúvidas e prazos numa página, com fusos e carga.", who: "A pessoa reordena, descarta e aprova." },
  { when: "Férias ou nova demanda", what: "Redistribuição", text: "O gêmeo do líder consulta os outros e monta um plano sem sobrecarga.", who: "O líder aprova; quem recebe pode recusar." },
  { when: "Sexta-feira", what: "Relatório", text: "Entregas e atuações da semana, com crédito por cada ajuda a um colega.", who: "A pessoa confere antes; segue ao RH 3 dias depois." },
];

const NEVER = [
  "Aprovar PR ou publicar em produção",
  "Falar na primeira pessoa como você",
  "Inventar números: eles vêm de regras fixas",
  "Dar nota, ranking ou opinar sobre salário, promoção ou demissão",
  "Ler mensagens privadas ou registrar tempo online",
  "Chamar quem está de férias",
  "Mudar tarefas sem a aprovação de uma pessoa",
];

const ROLES = [
  { role: "Desenvolvedor", gain: "Menos interrupção, plano pronto de manhã, correções adiantadas e crédito pela ajuda." },
  { role: "Revisor", gain: "Primeira análise pronta antes de revisar." },
  { role: "Líder", gain: "Redistribuição montada e visão do que está parado." },
  { role: "RH", gain: "Relatório semanal legível, sem precisar interpretar commits." },
  { role: "Empresa", gain: "Menos espera, menos retrabalho, mais previsibilidade." },
];

const CITY: Record<string, [number, number]> = {
  FOR: [-3.73, -38.53],
  JNB: [-26.2, 28.05],
  TYO: [35.68, 139.65],
};

/** Etiqueta ao lado do ponto: os bonequinhos, quem está ali e a hora local. */
function GlobeCrew({ ids, twin, code, tz, caption }: { ids: string[]; twin?: boolean; code: string; tz: string; caption: string }) {
  return (
    <span className="globe__tag">
      <span className="globe__crew">
        {ids.map((id) => (
          <PixelSprite key={id} look={lookFor(id)} mode={twin ? "twin" : "person"} size={30} />
        ))}
      </span>
      <span className="globe__text">
        <span className="globe__who">{caption}</span>
        <span className="lp-mono">
          {code} {localTime(DEMO_NOW, tz)}
        </span>
      </span>
    </span>
  );
}

const YAN: [number, number] = [43.06, 141.35];

/** Halo verde onde há gente no expediente; azul onde o gêmeo está no comando. */
const POINTS: GlobePoint[] = [
  { id: "fernando", location: CITY.FOR!, tone: "twin", halo: 11, label: <GlobeCrew ids={["fernando"]} twin caption="Gêmeo de Fernando" code="FOR" tz="America/Fortaleza" /> },
  { id: "jnb", location: CITY.JNB!, tone: "on", halo: 11, label: <GlobeCrew ids={["eduardo", "rita"]} caption="Eduardo, Rita" code="JNB" tz="Africa/Johannesburg" /> },
  { id: "tyo", location: CITY.TYO!, tone: "on", halo: 10, label: <GlobeCrew ids={["marina", "bruno", "carla"]} caption="Marina, Bruno, Carla" code="TYO" tz="Asia/Tokyo" /> },
  { id: "yan", location: YAN, tone: "wait", halo: 5, side: "left", label: <GlobeCrew ids={["yan"]} twin caption="Gêmeo de Yan · férias" code="TYO" tz="Asia/Tokyo" /> },
];

/** Branco: a pergunta da vez. Azul: um agente respondendo. Verde: quem está trabalhando agora. */
const ARCS: GlobeArc[] = [
  { id: "pergunta", from: CITY.JNB!, to: CITY.FOR!, tone: "ask" },
  { id: "agente-yan", from: YAN, to: CITY.JNB!, tone: "twin" },
  { id: "expediente", from: CITY.JNB!, to: CITY.TYO!, tone: "on" },
];

const COUNTS = {
  on: PERSONAS.filter((p) => p.availability.kind === "working").length,
  twin: PERSONAS.filter((p) => p.availability.kind === "off").length,
  wait: PERSONAS.filter((p) => p.availability.kind === "vacation").length,
};

function Pill() {
  return <span className="lp-pill">Exemplo</span>;
}

export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link href="/landing" className="lp-logo" aria-label="Echo">
          echo<span>.</span>
        </Link>
        <nav className="lp-nav__links" aria-label="Seções">
          <a href="#como-funciona">Como funciona</a>
          <a href="#nunca">O que nunca faz</a>
          <a href="#para-quem">Para quem</a>
        </nav>
        <div className="lp-nav__actions">
          <Link href="/entrar" className="lp-btn lp-btn--outline lp-btn--sm">
            Entrar
          </Link>
          <Link href="/entrar" className="lp-btn lp-btn--paper lp-btn--sm">
            Testar a demo
          </Link>
        </div>
      </header>

      <main className="lp-main">
        <DotField />
        <section className="lp-hero" aria-labelledby="tese">
          <div className="lp-hero__copy">
            <h1 id="tese" className="lp-display">
              O trabalho continua quando a pessoa não está.
            </h1>
            <p className="lp-lead">
              O Echo dá a cada pessoa um agente que conhece o trabalho dela. Ele responde aos colegas na ausência dela, adianta revisões à noite e ajuda a liderança a redistribuir tarefas sem sobrecarregar ninguém.
            </p>
            <div className="lp-actions">
              <Link href="/entrar" className="lp-btn lp-btn--paper">
                Testar a demo
              </Link>
              <a href="#como-funciona" className="lp-btn lp-btn--ghost">
                Ver como funciona
              </a>
            </div>
          </div>

          <div className="lp-hero__globe">
            <EchoGlobe points={POINTS} arcs={ARCS} focusLongitude={-22} theta={0.18} />
            <ul className="lp-legend" aria-label="Equipe da demonstração agora">
              <li>
                <span className="lp-dot" aria-hidden="true" /> {COUNTS.on} trabalhando
              </li>
              <li>
                <span className="lp-dot lp-dot--twin" aria-hidden="true" /> {COUNTS.twin} coberto pelo agente
              </li>
              <li>
                <span className="lp-dot lp-dot--wait" aria-hidden="true" /> {COUNTS.wait} de férias
              </li>
            </ul>
            <article className="lp-chat" aria-label="Exemplo de resposta do agente">
              <p className="lp-chat__head">
                <b>Eduardo</b>
                <span className="lp-mono">JNB {localTime(DEMO_NOW, "Africa/Johannesburg")}</span>
              </p>
              <p>@Fernando posso seguir com a branch ech-131-api-v2?</p>
              <p className="lp-chat__head lp-chat__head--agent">
                <b className="lp-twin">Agente de Fernando</b>
                <span className="lp-mono">Fernando está fora · FOR {localTime(DEMO_NOW, "America/Fortaleza")}</span>
              </p>
              <p>Sim: Fernando deixou essa branch liberada na nota do dia confirmada. Ele volta às 9h.</p>
              <span className="lp-source">Fonte: nota do dia de Fernando</span>
            </article>
          </div>
        </section>

        <section className="lp-integrations" aria-labelledby="integracoes">
          <h2 id="integracoes" className="lp-integrations__title">
            Conecta onde a equipe já trabalha
          </h2>
          <IntegrationsMarquee />
        </section>

        <section className="lp-section" aria-labelledby="noite-titulo">
          <div className="lp-section__intro">
            <h2 id="noite-titulo" className="lp-headline">
              Uma noite de Fernando, em documentos.
            </h2>
            <p className="lp-lead">Tudo o que o agente prepara enquanto ele dorme, e quem decide sobre cada coisa.</p>
          </div>
          <div className="lp-night" id="noite" aria-label="Uma noite de Fernando, de 18:00 a 08:45 em Fortaleza">
            <ol className="lp-axis" aria-hidden="true">
              {NIGHT.map((n, i) => (
                <li key={n.at} style={{ "--i": i } as CSSProperties}>
                  <span className={`lp-pin lp-pin--${n.tone}`} />
                  <span className="lp-mono">{i === 0 ? `FOR ${n.at}` : n.at}</span>
                </li>
              ))}
            </ol>

            <div className="lp-windows">
              <article className="lp-win" style={{ "--i": 0, "--r": "-1.5deg" } as CSSProperties}>
                <header className="lp-win__head">
                  Nota do dia · Fernando <Pill />
                </header>
                <div className="lp-win__body">
                  <p className="lp-row">
                    <span>ech-131-api-v2</span>
                    <span className="lp-mono lp-on">LIBERADA</span>
                  </p>
                  <p className="lp-row">
                    <span>ech-128-tempo-limite</span>
                    <span className="lp-mono lp-wait">RESERVADA</span>
                  </p>
                  <p className="lp-row">
                    <span>Parou em</span>
                    <span className="lp-mono">cliente.ts</span>
                  </p>
                </div>
                <footer className="lp-win__foot">{NIGHT[0].who}</footer>
              </article>

              <article className="lp-win" style={{ "--i": 1, "--r": "1deg" } as CSSProperties}>
                <header className="lp-win__head">
                  #time-produto <Pill />
                </header>
                <div className="lp-win__body">
                  <p>
                    <b>Eduardo</b> @Fernando posso seguir com a ech-131-api-v2?
                  </p>
                  <p>
                    <b className="lp-twin">Agente de Fernando</b> Sim: liberada na nota do dia confirmada. Fernando volta às 9h de Fortaleza.
                  </p>
                  <span className="lp-source">Fonte: nota do dia (confirmada)</span>
                </div>
                <footer className="lp-win__foot">{NIGHT[1].who}</footer>
              </article>

              <article className="lp-win" style={{ "--i": 2, "--r": "-0.6deg" } as CSSProperties}>
                <header className="lp-win__head">
                  Revisão noturna · PR 41 <Pill />
                </header>
                <div className="lp-win__body">
                  <pre className="lp-diff" aria-label="Diferença no código">
                    <span className="lp-diff__del">− timeout: 30_000</span>
                    <span className="lp-diff__add">+ timeout: 8_000</span>
                  </pre>
                  <p>Correção pronta numa versão separada. Nada foi aprovado.</p>
                </div>
                <footer className="lp-win__foot">{NIGHT[2].who}</footer>
              </article>

              <article className="lp-win" style={{ "--i": 3, "--r": "1.4deg" } as CSSProperties}>
                <header className="lp-win__head">
                  Plano da manhã <Pill />
                </header>
                <div className="lp-win__body">
                  <p className="lp-row">
                    <span>Aprovar correção</span>
                    <span className="lp-mono">PR 41</span>
                  </p>
                  <p className="lp-row">
                    <span>Responder Eduardo</span>
                    <span className="lp-mono">ech-128</span>
                  </p>
                  <p className="lp-row">
                    <span>Revisar PR de Carla</span>
                    <span className="lp-mono">PR 34</span>
                  </p>
                </div>
                <footer className="lp-win__foot">{NIGHT[3].who}</footer>
              </article>
            </div>
          </div>
        </section>

        <section className="lp-section" id="como-funciona" aria-labelledby="ciclo">
          <div className="lp-section__intro">
            <h2 id="ciclo" className="lp-headline">
              Um dia inteiro coberto, e cada decisão com dono.
            </h2>
            <p className="lp-lead">O Echo prepara. Uma pessoa decide. Em toda etapa, está escrito quem.</p>
          </div>
          <ol className="lp-day">
            {DAY.map((d) => (
              <li key={d.what} className="lp-day__item">
                <span className="lp-mono lp-day__when">{d.when}</span>
                <h3 className="lp-day__what">{d.what}</h3>
                <p className="lp-day__text">{d.text}</p>
                <p className="lp-day__who">
                  <span className="lp-dot" aria-hidden="true" />
                  {d.who}
                </p>
              </li>
            ))}
            <li className="lp-day__item lp-day__cta-wrap">
              <Link href="/entrar" className="lp-day__cta-link">
                <span className="lp-mono lp-day__when">Agora mesmo</span>
                <span className="lp-day__what">Veja a noite de Fernando na demo</span>
                <span className="lp-day__who">Entrar como Eduardo →</span>
              </Link>
            </li>
          </ol>
        </section>

        <section className="lp-section lp-split" aria-labelledby="ajuda">
          <div className="lp-section__intro">
            <h2 id="ajuda" className="lp-headline">
              Quem ajuda os outros finalmente aparece.
            </h2>
            <p className="lp-lead">
              Uma revisão que mudou o código, um colega destravado, uma reação de obrigado no Slack. Cada ajuda vira crédito, sempre com fonte ou confirmação de quem foi ajudado.
            </p>
          </div>
          <article className="lp-win lp-win--static">
            <header className="lp-win__head">
              Relatório da semana · Carla <Pill />
            </header>
            <div className="lp-win__body">
              <p className="lp-row">
                <span>Commits</span>
                <span className="lp-mono">poucos</span>
              </p>
              <p className="lp-row">
                <span>Entregas</span>
                <span className="lp-mono">0</span>
              </p>
              <p className="lp-row">
                <span>Ajudas a colegas</span>
                <span className="lp-mono lp-on">5 confirmadas</span>
              </p>
              <p className="lp-row lp-row--note">
                <span>&ldquo;Fiz 100 entregas&rdquo;</span>
                <span className="lp-mono lp-wait">INFORMADO PELA PESSOA</span>
              </p>
            </div>
            <footer className="lp-win__foot">Carla confere antes. Os números não mudam com o texto.</footer>
          </article>
        </section>

        <section className="lp-trust" id="nunca" aria-labelledby="nunca-titulo">
          <div className="lp-trust__inner">
            <h2 id="nunca-titulo" className="lp-headline">
              O que o Echo nunca faz.
            </h2>
            <p className="lp-trust__lead">O agente só lê. Toda ação sensível passa por uma pessoa, e fica registrado quem aprovou.</p>
            <ul className="lp-never">
              {NEVER.map((n) => (
                <li key={n}>
                  <span className="lp-never__mark" aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" id="para-quem" aria-labelledby="quem">
          <div className="lp-section__intro">
            <h2 id="quem" className="lp-headline">
              Para equipes que trabalham em fusos diferentes.
            </h2>
            <p className="lp-lead">O RH contrata, vendo a espera entre fusos como problema de operação e previsibilidade. O líder de tecnologia autoriza os acessos.</p>
          </div>
          <dl className="lp-roles">
            {ROLES.map((r) => (
              <div key={r.role} className="lp-roles__row">
                <dt>{r.role}</dt>
                <dd>{r.gain}</dd>
              </div>
            ))}
          </dl>
          <p className="lp-mono lp-stack">GITHUB · LINEAR · SLACK · RH POR AVISO ASSINADO · POWERED BY CLAUDE</p>
        </section>

        <section className="lp-close" aria-labelledby="fim">
          <h2 id="fim" className="lp-headline-lg">
            Fernando dorme em Fortaleza. Pergunte ao agente dele.
          </h2>
          <p className="lp-lead">A demo usa uma empresa fictícia, com dados sintéticos. Entre como Eduardo e pergunte se pode seguir com a ech-131-api-v2.</p>
          <Link href="/entrar" className="lp-btn lp-btn--paper">
            Testar a demo
          </Link>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="lp-logo">
          echo<span>.</span>
        </span>
        <span className="lp-mono">Converge Challenge · Canastra Ventures · Powered by Claude</span>
      </footer>
    </div>
  );
}
