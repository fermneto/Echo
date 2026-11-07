import {
  siAsana,
  siClaude,
  siConfluence,
  siDiscord,
  siGithub,
  siGithubactions,
  siGitlab,
  siGooglecalendar,
  siGoogledrive,
  siJira,
  siLinear,
  siNotion,
  siOkta,
  siPagerduty,
  siSentry,
  siVercel,
} from "simple-icons";
import { LogoCarousel } from "./LogoCarousel";

/**
 * Integrações: "hoje" é o que a primeira versão conecta (docs/produto.md); "em breve" são as
 * etapas 18 a 24 de docs/engenharia.md. Não marcar como "hoje" o que ainda é plano.
 */

type Integration = { name: string; status: "hoje" | "em breve"; path?: string };

/** Símbolo do Slack desenhado à mão, monocromático (não existe no simple-icons). */
const SLACK_PATH =
  "M5.04 15.17a2.53 2.53 0 1 1-2.52-2.53h2.52zm1.27 0a2.53 2.53 0 0 1 5.05 0v6.31a2.53 2.53 0 1 1-5.05 0zM8.83 5.04a2.53 2.53 0 1 1 2.53-2.52v2.52zm0 1.27a2.53 2.53 0 0 1 0 5.05H2.52a2.53 2.53 0 0 1 0-5.05zm10.13 2.52a2.53 2.53 0 1 1 2.52 2.53h-2.52zm-1.27 0a2.53 2.53 0 0 1-5.05 0V2.52a2.53 2.53 0 1 1 5.05 0zm-2.52 10.13a2.53 2.53 0 1 1-2.53 2.52v-2.52zm0-1.27a2.53 2.53 0 0 1 0-5.05h6.31a2.53 2.53 0 0 1 0 5.05z";

export const INTEGRATIONS: readonly Integration[] = [
  { name: "GitHub", status: "hoje", path: siGithub.path },
  { name: "Slack", status: "hoje", path: SLACK_PATH },
  { name: "Linear", status: "hoje", path: siLinear.path },
  { name: "Claude", status: "hoje", path: siClaude.path },
  { name: "Google Calendar", status: "em breve", path: siGooglecalendar.path },
  { name: "Outlook", status: "em breve" },
  { name: "GitHub Actions", status: "em breve", path: siGithubactions.path },
  { name: "Vercel", status: "em breve", path: siVercel.path },
  { name: "Sentry", status: "em breve", path: siSentry.path },
  { name: "PagerDuty", status: "em breve", path: siPagerduty.path },
  { name: "Jira", status: "em breve", path: siJira.path },
  { name: "GitLab", status: "em breve", path: siGitlab.path },
  { name: "Asana", status: "em breve", path: siAsana.path },
  { name: "Microsoft Teams", status: "em breve" },
  { name: "Discord", status: "em breve", path: siDiscord.path },
  { name: "Notion", status: "em breve", path: siNotion.path },
  { name: "Confluence", status: "em breve", path: siConfluence.path },
  { name: "Google Drive", status: "em breve", path: siGoogledrive.path },
  { name: "Okta", status: "em breve", path: siOkta.path },
];

/** Integrações em colunas que trocam de logo. A lista completa fica legível para leitores de tela. */
export function IntegrationsCarousel() {
  const logos = INTEGRATIONS.map(({ name, status, path }) => ({ name, status, ...(path ? { path } : {}) }));
  return (
    <>
      <ul className="sr-only" aria-label="Integrações do Echo">
        {INTEGRATIONS.map((i) => (
          <li key={i.name}>
            {i.name}
            {i.status === "em breve" ? " (em breve)" : ""}
          </li>
        ))}
      </ul>
      <LogoCarousel logos={logos} columns={4} />
    </>
  );
}
