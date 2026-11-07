import { loadConfig } from "@echo/config";

/** Configuração do login com Slack. null = não configurado neste ambiente. */
export function slackLoginConfig() {
  const c = loadConfig("web");
  if (!c.SLACK_CLIENT_ID || !c.SLACK_CLIENT_SECRET || !c.SESSION_SECRET || !c.PANEL_URL || !c.DATABASE_URL) return null;
  return {
    clientId: c.SLACK_CLIENT_ID,
    clientSecret: c.SLACK_CLIENT_SECRET,
    sessionSecret: c.SESSION_SECRET,
    redirectUri: `${c.PANEL_URL.replace(/\/$/, "")}/api/sessao/slack/retorno`,
    panelUrl: c.PANEL_URL.replace(/\/$/, ""),
    team: c.DEMO_SLACK_TEAM_ID,
  };
}

/** Mensagens da tela de entrada para cada motivo de recusa. */
export const LOGIN_ERRORS: Record<string, string> = {
  nao_configurado: "O login com o Slack não está configurado neste ambiente.",
  tentativa_invalida: "O login expirou ou não começou aqui. Tente de novo.",
  slack_recusou: "O Slack não confirmou o login. Tente de novo.",
  cancelado: "Login cancelado no Slack.",
  espaco_desconhecido: "Este espaço do Slack não está ligado a nenhuma empresa no Echo.",
  pessoa_nao_cadastrada: "Sua conta do Slack ainda não está cadastrada no Echo. Fale com o RH da sua empresa.",
  pessoa_inativa: "Seu acesso ao Echo foi encerrado.",
};
