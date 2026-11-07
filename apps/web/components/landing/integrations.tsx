import { siClaude, siGithub, siGithubactions, siGitlab, siGooglecalendar, siJira, siLinear, siNotion, siVercel } from "simple-icons";
import { LogoCarousel } from "./LogoCarousel";

/**
 * Integrações: "hoje" é o que já tem conector em packages/connectors (GitHub, Slack, Linear,
 * agenda e CI/CD); "em breve" são as próximas etapas de docs/engenharia.md. Não marcar como
 * "hoje" o que ainda é plano.
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
  { name: "Google Calendar", status: "hoje", path: siGooglecalendar.path },
  { name: "Outlook", status: "hoje" },
  { name: "GitHub Actions", status: "hoje", path: siGithubactions.path },
  { name: "Vercel", status: "hoje", path: siVercel.path },
  { name: "Jira", status: "em breve", path: siJira.path },
  { name: "GitLab", status: "em breve", path: siGitlab.path },
  { name: "Microsoft Teams", status: "em breve" },
  { name: "Notion", status: "em breve", path: siNotion.path },
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
