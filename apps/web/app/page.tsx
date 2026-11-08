import type { Metadata } from "next";
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { EchoGlobe, type GlobeArc, type GlobePoint } from "@/components/landing/EchoGlobe";
import { DotField } from "@/components/landing/DotField";
import { CardStack } from "@/components/landing/CardStack";
import { MOMENTS } from "@/components/landing/moments";
import { IntegrationsCarousel } from "@/components/landing/integrations";
import { LandingMotion } from "@/components/landing/LandingMotion";
import { StartButton } from "@/components/landing/StartButton";
import { WaitRace } from "@/components/landing/WaitRace";
import { PixelSprite, type SpriteMode } from "@/components/PixelSprite";
import { lookFor } from "@/lib/demo/looks";
import { WORLD, worldCounts, worldState, type WorldMember } from "@/lib/demo/world";
import { DEMO_NOW } from "@/lib/demo/personas";
import { siteUrl } from "@/lib/site-url";
import { localTime } from "@/lib/time";
import "./landing/landing.css";

const TITLE = "Echo · A resposta não precisa esperar até amanhã";
const DESCRIPTION = "Cada pessoa da equipe tem um gêmeo digital que responde quando ela dorme, revisa à noite e deixa o plano pronto de manhã.";

/** Lido a cada requisição: o endereço público só existe em produção, depois do build. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const image = { url: "/imagem-social", width: 1200, height: 630, alt: "Echo: a resposta não precisa esperar até amanhã." };
  return {
    metadataBase: new URL(siteUrl()),
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/" },
    openGraph: { type: "website", locale: "pt_BR", siteName: "Echo", url: "/", title: TITLE, description: DESCRIPTION, images: [image] },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [image.url] },
  };
}

/* Conteúdo: docs/produto.md. Pessoas e conversas são ilustrativas, com dados sintéticos. */


const DAY = [
  { when: "Durante o dia", what: "Registro", text: "O gêmeo registra commits, PRs, tarefas e ajudas confirmadas.", who: "Ninguém: é só registro." },
  { when: "Pessoa citada e fora", what: "Resposta", text: "Responde colegas citando a fonte, sempre identificado como agente. O status é olhado na hora da menção e não fica guardado.", who: "Quem perguntou decide o que fazer." },
  { when: "Fim do expediente", what: "Nota do dia", text: "Rascunha onde a pessoa parou, o que travou, o que está liberado e o que está reservado, e manda o resumo do dia como imagem no privado.", who: "A pessoa confere e publica." },
  { when: "Noite", what: "Revisão", text: "Revisa os PRs em lote e deixa a correção pronta numa versão separada.", who: "O autor aprova de manhã, ou antes, se deixou isso escrito numa delegação." },
  { when: "Manhã", what: "Plano", text: "A agenda do dia em ordem, com prazos, dependências, correções prontas e quem espera por você.", who: "A pessoa muda o dia de qualquer tarefa." },
  { when: "Tarefa nova", what: "Distribuição", text: "O líder vê a carga de cada pessoa e atribui. O agente encaixa a tarefa na agenda dela.", who: "O líder decide quem recebe." },
  { when: "Férias ou nova demanda", what: "Redistribuição", text: "O Echo monta um plano por regra, respeitando áreas e carga, sem sobrecarregar ninguém.", who: "O líder aprova." },
  { when: "Sexta-feira", what: "Relatório", text: "Entregas e atuações da semana, com crédito por cada ajuda a um colega, e o vídeo da semana da equipe.", who: "A pessoa confere antes; segue ao RH 3 dias depois." },
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

const GAINS = [
  { what: "Dúvida sobre o trabalho de um colega", before: "Espera a pessoa voltar", after: "Resposta na hora, com a fonte" },
  { what: "Revisão de PR", before: "Começa quando o revisor chega", after: "Primeira análise pronta de manhã" },
  { what: "Começar o dia", before: "Procurar o que ficou pendente", after: "Agenda pronta, na ordem e com o motivo" },
  { what: "Férias de alguém", before: "Repartir tarefas na conversa", after: "Plano por regra, sem sobrecarregar ninguém" },
];

const CITY: Record<string, [number, number]> = {
  FOR: [-3.73, -38.53],
  JNB: [-26.2, 28.05],
  TYO: [35.68, 139.65],
};

/** Etiqueta ao lado do ponto: os bonequinhos, quem está ali e a hora local. */
function GlobeCrew({ ids, mode = "person", code, tz, caption }: { ids: string[]; mode?: SpriteMode; code: string; tz: string; caption: string }) {
  return (
    <span className="globe__tag">
      <span className="globe__crew">
        {ids.map((id) => (
          <PixelSprite key={id} look={lookFor(id)} mode={mode} size={28} />
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

/** Uma fala no cartão do ponto: quem, onde e que horas, e o que disse. */
function Line({ who, agent, meta, children }: { who: string; agent?: boolean; meta: string; children: ReactNode }) {
  return (
    <>
      <p className={`lp-chat__head${agent ? " lp-chat__head--agent" : ""}`}>
        <b>{who}</b>
        <span className="lp-mono">{meta}</span>
      </p>
      <p>{children}</p>
    </>
  );
}

const JNB_T = localTime(DEMO_NOW, "Africa/Johannesburg");
const FOR_T = localTime(DEMO_NOW, "America/Fortaleza");
const TYO_T = localTime(DEMO_NOW, "Asia/Tokyo");

const DETAIL = {
  fernando: (
    <div className="lp-chat">
      <Line who="Eduardo" meta={`JNB ${JNB_T}`}>
        @Fernando posso seguir com a branch ech-131-api-v2?
      </Line>
      <Line who="Agente de Fernando" agent meta={`Fernando está fora · FOR ${FOR_T}`}>
        Sim: Fernando deixou essa branch liberada na nota do dia confirmada. Ele volta às 9h.
      </Line>
      <span className="lp-source">Fonte: nota do dia de Fernando</span>
    </div>
  ),
  jnb: (
    <div className="lp-chat">
      <Line who="Eduardo e Rita" meta={`no expediente · JNB ${JNB_T}`}>
        Os dois estão trabalhando agora. O Echo não responde por quem está no expediente: a pergunta vai direto para a pessoa.
      </Line>
      <span className="lp-source">Fonte: expedientes cadastrados</span>
    </div>
  ),
  tyo: (
    <div className="lp-chat">
      <Line who="Echo" meta="para Marina · TYO 10:15">
        Plano para as férias de Bruno (10 a 21/11): ECH-133 → Carla, ECH-137 → Eduardo, revisão do PR 36 → Fernando. Nada muda até você aprovar.
      </Line>
      <Line who="Marina, Bruno, Carla" meta={`no expediente · TYO ${TYO_T}`}>
        Respondem por si mesmos durante o dia.
      </Line>
      <span className="lp-source">Fonte: carga e áreas da equipe</span>
    </div>
  ),
  yan: (
    <div className="lp-chat">
      <Line who="Eduardo" meta="JNB 09:02">
        @Yan o ECH-140 já terminou?
      </Line>
      <Line who="Agente de Yan" agent meta="Yan está de férias · TYO 16:02">
        Está &ldquo;Em andamento&rdquo; no Linear agora, prazo na sexta. O PR ligado está aberto, sem revisão.
      </Line>
      <p className="lp-chat__warn">Aviso: Yan não confirmou a nota do dia mais recente.</p>
      <span className="lp-source">Fonte: ECH-140 no Linear (ao vivo)</span>
    </div>
  ),
};

/** Halo verde onde há gente no expediente; azul onde o gêmeo está no comando. */
const POINTS: GlobePoint[] = [
  { id: "fernando", location: CITY.FOR!, tone: "twin", halo: 15, place: "Fortaleza", detail: DETAIL.fernando, label: <GlobeCrew ids={["fernando"]} mode="twin" caption="Gêmeo de Fernando" code="FOR" tz="America/Fortaleza" /> },
  { id: "jnb", location: CITY.JNB!, tone: "on", halo: 14, place: "Joanesburgo", detail: DETAIL.jnb, label: <GlobeCrew ids={["eduardo", "rita"]} caption="Eduardo, Rita" code="JNB" tz="Africa/Johannesburg" /> },
  { id: "tyo", location: CITY.TYO!, tone: "on", halo: 12, place: "Tóquio", detail: DETAIL.tyo, label: <GlobeCrew ids={["marina", "bruno", "carla"]} caption="Marina, Bruno, Carla" code="TYO" tz="Asia/Tokyo" /> },
  { id: "yan", location: YAN, tone: "wait", halo: 6, side: "left", place: "Tóquio, com Yan de férias", detail: DETAIL.yan, label: <GlobeCrew ids={["yan"]} mode="away" caption="Gêmeo de Yan · férias" code="TYO" tz="Asia/Tokyo" /> },
];

const member = (id: string) => WORLD.find((m) => m.id === id)!;
const at = (m: WorldMember) => `${m.cityCode} ${localTime(DEMO_NOW, m.timezone)}`;

/** Conversas entre quem trabalha na Ásia e os agentes de quem dorme. Fictícias. */
const WORLD_TALKS = [
  {
    from: "priya",
    to: "ines",
    ask: "@Inês o contrato da API de faturas mudou?",
    answer: "Não: Inês deixou o contrato congelado na nota do dia até a revisão de segunda. Ela volta às 9h de Lisboa.",
    source: "nota do dia de Inês",
  },
  {
    from: "wei",
    to: "jonas",
    ask: "@Jonas posso fazer o deploy da fila nova?",
    answer: "Não há liberação para esse deploy na nota do dia de Jonas. A dúvida entra no plano da manhã dele, às 9h de Berlim.",
    source: "nota do dia de Jonas",
  },
  {
    from: "olivia",
    to: "ana",
    ask: "@Ana o PR 88 já tem revisão?",
    answer: "Ainda não: o PR 88 está aberto e esperando revisão. Ana volta às 9h de São Paulo.",
    source: "PR 88 no GitHub (ao vivo)",
  },
] as const;

function talkCard(t: (typeof WORLD_TALKS)[number]) {
  const a = member(t.from);
  const b = member(t.to);
  return (
    <div className="lp-chat">
      <Line who={a.name} meta={at(a)}>
        {t.ask}
      </Line>
      <Line who={`Agente de ${b.name}`} agent meta={`${b.name} está fora · ${at(b)}`}>
        {t.answer}
      </Line>
      <span className="lp-source">Fonte: {t.source}</span>
    </div>
  );
}

function worldDetail(m: WorldMember) {
  const talk = WORLD_TALKS.find((t) => t.from === m.id || t.to === m.id);
  if (talk) return talkCard(talk);
  const state = worldState(m);
  const text =
    state === "wait"
      ? `${m.name} está de férias. O agente cobre e ninguém chama quem está de férias.`
      : state === "twin"
        ? `${m.name} começa às 9h em ${m.city}. Até lá, o agente responde por ${m.name}, sempre citando a fonte.`
        : `${m.name} está no expediente em ${m.city} e responde por si.`;
  return (
    <div className="lp-chat">
      <Line who={state === "on" ? m.name : `Agente de ${m.name}`} agent={state !== "on"} meta={at(m)}>
        {text}
      </Line>
    </div>
  );
}

/** A equipe pelo mundo: etiqueta só ao passar o mouse; conversa ao clicar. */
const WORLD_POINTS: GlobePoint[] = WORLD.map((m) => {
  const state = worldState(m);
  const mode: SpriteMode = state === "on" ? "person" : state === "twin" ? "twin" : "away";
  const caption = state === "on" ? m.name : state === "twin" ? `Gêmeo de ${m.name}` : `Gêmeo de ${m.name} · férias`;
  return {
    id: m.id,
    location: m.location,
    tone: state,
    halo: 7,
    quiet: true,
    place: m.city,
    detail: worldDetail(m),
    label: (
      <span className="globe__tag">
        <span className="globe__crew">
          <PixelSprite look={lookFor(m.id)} mode={mode} size={28} />
        </span>
        <span className="globe__text">
          <span className="globe__who">{caption}</span>
          <span className="lp-mono">{at(m)}</span>
        </span>
      </span>
    ),
  };
});

const ALL_POINTS = [...POINTS, ...WORLD_POINTS];

/** Branco: a pergunta da vez. Azul: um agente respondendo. Verde: quem está trabalhando agora. */
const ARCS: GlobeArc[] = [
  { id: "pergunta", from: CITY.JNB!, to: CITY.FOR!, tone: "ask" },
  { id: "agente-yan", from: YAN, to: CITY.JNB!, tone: "twin" },
  { id: "expediente", from: CITY.JNB!, to: CITY.TYO!, tone: "on" },
  ...WORLD_TALKS.map((t) => ({ id: `${t.from}-${t.to}`, from: member(t.from).location, to: member(t.to).location, tone: "twin" as const })),
  { id: "seul-singapura", from: member("jiwoo").location, to: member("wei").location, tone: "on" },
  { id: "dubai-bangalore", from: member("omar").location, to: member("priya").location, tone: "on" },
];

// A landing é um exemplo roteirizado: fica no instante da história, não no relógio real.
const COUNTS = worldCounts(DEMO_NOW);

export default function LandingPage() {
  return (
    <div className="lp">
      <a className="skip-link" href="#tese">
        Pular para o conteúdo
      </a>
      <header className="lp-nav">
        <Link href="/" className="lp-logo" aria-label="Echo">
          echo<span className="lp-logo__dot" aria-hidden="true" />
        </Link>
        <nav className="lp-nav__links" aria-label="Seções">
          <a href="#ganhos">Produtividade</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#nunca">O que nunca faz</a>
          <a href="#para-quem">Para quem</a>
        </nav>
        <div className="lp-nav__actions">
          <Link href="/entrar" className="lp-btn lp-btn--outline lp-btn--sm">
            Entrar
          </Link>
          <StartButton small />
        </div>
      </header>

      <main className="lp-main">
        <LandingMotion />
        <DotField />
        <section className="lp-hero" aria-labelledby="tese">
          <div className="lp-hero__copy">
            <h1 id="tese" className="lp-display">
              A resposta não precisa esperar até amanhã.
            </h1>
            <p className="lp-lead">
              O Echo dá a cada pessoa um agente que conhece o trabalho dela. Ele responde aos colegas na ausência dela, adianta revisões à noite, organiza o dia de cada um e ajuda a liderança a distribuir tarefas sem sobrecarregar ninguém.
            </p>
            <div className="lp-actions">
              <StartButton />
              <a href="#como-funciona" className="lp-btn lp-btn--ghost">
                Ver como funciona
              </a>
            </div>
          </div>

          <div className="lp-hero__globe">
            <EchoGlobe points={ALL_POINTS} arcs={ARCS} focusLongitude={-12} theta={0.3} />
            <ul className="lp-legend" aria-label="Equipe agora">
              <li>
                <span className="lp-dot" aria-hidden="true" /> {COUNTS.on} trabalhando
              </li>
              <li>
                <span className="lp-dot lp-dot--twin" aria-hidden="true" /> {COUNTS.twin} {COUNTS.twin === 1 ? "coberta" : "cobertas"} pelo agente
              </li>
              <li>
                <span className="lp-dot lp-dot--wait" aria-hidden="true" /> {COUNTS.wait} de férias
              </li>
              <li className="lp-legend__hint">
                <span className="lp-hint--hover">Passe o mouse num ponto para ver a conversa</span>
                <span className="lp-hint--touch">Toque num ponto para ver a conversa</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-integrations" aria-labelledby="integracoes">
          <div className="lp-integrations__inner">
            <div className="lp-integrations__copy">
              <h2 id="integracoes" className="lp-integrations__title">
                Conecta onde a equipe já trabalha.
              </h2>
              <p className="lp-integrations__lead">
                GitHub, Slack, Linear, Jira, agenda e CI hoje, com Claude por trás. GitLab, Teams e Notion a seguir.
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
            <p className="lp-lead">Uma noite entre fusos: Fernando dorme em Fortaleza, Eduardo trabalha em Joanesburgo e Tóquio vive a tarde. Cada momento diz quem decide.</p>
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
          </ol>
        </section>

        <section className="lp-section" id="ganhos" aria-labelledby="ganhos-titulo">
          <div className="lp-section__intro">
            <h2 id="ganhos-titulo" className="lp-headline">
              A espera vira trabalho.
            </h2>
            <p className="lp-lead">Entre fusos, uma dúvida simples pode custar meio dia. O Echo responde na hora, adianta a revisão e deixa o dia de cada pessoa organizado.</p>
          </div>
          <WaitRace />
          <table className="lp-gains">
            <thead>
              <tr>
                <td />
                <th scope="col">Antes</th>
                <th scope="col">Com o Echo</th>
              </tr>
            </thead>
            <tbody>
              {GAINS.map((g) => (
                <tr key={g.what}>
                  <th scope="row">{g.what}</th>
                  <td className="lp-gains__before">{g.before}</td>
                  <td className="lp-gains__after">{g.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lp-gains__foot">O painel mede a espera evitada e as revisões da sua equipe, só em totais.</p>
        </section>

        <section className="lp-section lp-split" aria-labelledby="ajuda">
          <div className="lp-section__intro">
            <h2 id="ajuda" className="lp-headline">
              Quem ajuda os outros finalmente aparece.
            </h2>
            <p className="lp-lead">
              Destravar um colega também é produtividade. Uma revisão que mudou o código, uma dúvida resolvida, uma reação de obrigado no Slack: cada ajuda vira crédito, sempre com fonte ou confirmação de quem foi ajudado.
            </p>
          </div>
          <article className="lp-win lp-win--static">
            <header className="lp-win__head">
              Relatório da semana · Carla
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
                <span className="lp-mono lp-on">
                  <span data-count="5">5</span> confirmadas
                </span>
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
            <p className="lp-trust__lead">O agente lê e executa, mas as ações sensíveis passam por uma pessoa, e fica registrado quem aprovou.</p>
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
            <p className="lp-lead">Para o RH, a espera entre fusos deixa de ser um problema de operação. O líder de tecnologia autoriza os acessos.</p>
          </div>
          <dl className="lp-roles">
            {ROLES.map((r) => (
              <div key={r.role} className="lp-roles__row">
                <dt>{r.role}</dt>
                <dd>{r.gain}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="lp-closing" aria-labelledby="comecar">
          <div>
            <h2 id="comecar" className="lp-headline-lg">
              Deixe o trabalho andar enquanto sua equipe dorme.
            </h2>
            <p className="lp-lead">Conecte o GitHub, o Slack e o Linear ou o Jira. Cada pessoa ganha um agente que conhece o trabalho dela.</p>
          </div>
          <StartButton />
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
                  <a href="#ganhos">Produtividade</a>
                </li>
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
              <p className="lp-footer__head">Conta</p>
              <ul role="list">
                <li>
                  <Link href="/entrar">Entrar</Link>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <p className="lp-footer__legal">
          Pessoas e conversas desta página são ilustrativas. GitHub, Linear, Jira, Slack e Claude são marcas de seus donos.
          <span className="lp-mono">Powered by Claude</span>
        </p>
      </footer>
    </div>
  );
}
