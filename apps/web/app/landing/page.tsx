import type { CSSProperties } from "react";
import Link from "next/link";
import { EchoGlobe, type GlobeArc, type GlobePoint } from "@/components/landing/EchoGlobe";
import { DotField } from "@/components/landing/DotField";
import { CardStack } from "@/components/landing/CardStack";
import { MOMENTS } from "@/components/landing/moments";
import { IntegrationsCarousel } from "@/components/landing/integrations";
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
  { id: "fernando", location: CITY.FOR!, tone: "twin", halo: 15, label: <GlobeCrew ids={["fernando"]} twin caption="Gêmeo de Fernando" code="FOR" tz="America/Fortaleza" /> },
  { id: "jnb", location: CITY.JNB!, tone: "on", halo: 14, label: <GlobeCrew ids={["eduardo", "rita"]} caption="Eduardo, Rita" code="JNB" tz="Africa/Johannesburg" /> },
  { id: "tyo", location: CITY.TYO!, tone: "on", halo: 12, label: <GlobeCrew ids={["marina", "bruno", "carla"]} caption="Marina, Bruno, Carla" code="TYO" tz="Asia/Tokyo" /> },
  { id: "yan", location: YAN, tone: "wait", halo: 6, side: "left", label: <GlobeCrew ids={["yan"]} twin caption="Gêmeo de Yan · férias" code="TYO" tz="Asia/Tokyo" /> },
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
            <EchoGlobe points={POINTS} arcs={ARCS} focusLongitude={-12} theta={0.3} />
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
          <div className="lp-integrations__inner">
            <div className="lp-integrations__copy">
              <h2 id="integracoes" className="lp-integrations__title">
                Conecta onde a equipe já trabalha.
              </h2>
              <p className="lp-integrations__lead">
                GitHub, Slack, Linear e Claude hoje. Agenda, CI, incidentes, outros trackers e chats a seguir.
              </p>
            </div>
            <IntegrationsCarousel />
          </div>
        </section>

        <section className="lp-section" id="em-acao" aria-labelledby="em-acao-titulo">
          <div className="lp-section__intro">
            <h2 id="em-acao-titulo" className="lp-headline">
              O Echo em ação, entre fusos.
            </h2>
            <p className="lp-lead">Uma noite da equipe da demo: Fernando dorme em Fortaleza, Eduardo trabalha em Joanesburgo e Tóquio vive a tarde. Cada momento diz quem decide.</p>
          </div>
          <CardStack items={MOMENTS} label="Momentos do Echo entre fusos" />
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
        {/* A marca com eco: cópias vazadas sobem e somem; o ponto acende como um medidor. */}
        <div className="lp-echo" aria-hidden="true">
          <span className="lp-echo__stack">
            {[6, 5, 4, 3, 2, 1].map((k) => (
              <span key={k} className="lp-echo__ghost" style={{ "--k": k } as CSSProperties}>
                echo
              </span>
            ))}
            <span className="lp-echo__word">echo</span>
          </span>
          <span className="lp-echo__dot">
            {[5, 4, 3, 2, 1].map((k) => (
              <span key={k} className="lp-echo__cell" style={{ "--k": k } as CSSProperties} />
            ))}
            <span className="lp-echo__cell is-on" />
          </span>
        </div>

        <div className="lp-footer__main">
          <p className="lp-footer__tagline">Continuidade do trabalho para equipes distribuídas.</p>
          <nav className="lp-footer__cols" aria-label="Rodapé">
            <div>
              <p className="lp-footer__head">Produto</p>
              <ul role="list">
                <li>
                  <a href="#como-funciona">Como funciona</a>
                </li>
                <li>
                  <a href="#em-acao">O Echo em ação</a>
                </li>
                <li>
                  <a href="#nunca">O que nunca faz</a>
                </li>
                <li>
                  <a href="#para-quem">Para quem</a>
                </li>
              </ul>
            </div>
            <div>
              <p className="lp-footer__head">Demo</p>
              <ul role="list">
                <li>
                  <Link href="/entrar">Testar a demo</Link>
                </li>
                <li>
                  <Link href="/entrar">Entrar</Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <p className="lp-footer__legal">
          Os nomes e as conversas desta página são exemplos, com dados sintéticos. GitHub, Linear, Slack e Claude são marcas de seus donos.
          <span className="lp-mono">Converge Challenge · Canastra Ventures · Powered by Claude</span>
        </p>
      </footer>
    </div>
  );
}
