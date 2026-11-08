import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sessão do painel para quem entra pelo Slack: cookie assinado (HMAC-SHA256 com SESSION_SECRET),
 * válido por 12 horas, só com ids e o papel. A pessoa é lida de novo do banco a cada página.
 */
export const SESSION_COOKIE = "echo_sessao";
export const OIDC_COOKIE = "echo_login";
export const SESSION_TTL_S = 12 * 60 * 60;
const OIDC_TTL_S = 10 * 60;

export interface PanelSession {
  orgId: string;
  personId: string;
  role: "member" | "leader" | "hr";
  /** Vencimento, em segundos. */
  exp: number;
}

const mac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");

function seal(secret: string, value: object): string {
  const data = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${data}.${mac(secret, data)}`;
}

function open<T extends { exp: number }>(secret: string, token: string | undefined, nowS: number): T | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(mac(secret, data));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const v = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T;
    return typeof v.exp === "number" && v.exp > nowS ? v : null;
  } catch {
    return null;
  }
}

export const signSession = (secret: string, s: Omit<PanelSession, "exp">, nowS = Math.floor(Date.now() / 1000)) => seal(secret, { ...s, exp: nowS + SESSION_TTL_S });
export const readSession = (secret: string, token: string | undefined, nowS = Math.floor(Date.now() / 1000)) => open<PanelSession>(secret, token, nowS);

/** state e nonce do login em andamento, num cookie curto e assinado (protege contra CSRF e reuso). */
export function newLoginAttempt(secret: string, nowS = Math.floor(Date.now() / 1000)) {
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  return { state, nonce, cookie: seal(secret, { state, nonce, exp: nowS + OIDC_TTL_S }) };
}
export const readLoginAttempt = (secret: string, token: string | undefined, nowS = Math.floor(Date.now() / 1000)) => open<{ state: string; nonce: string; exp: number }>(secret, token, nowS);

export const cookieOptions = (maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production", maxAge });

/** Para onde voltar depois do login com o Slack (só caminho interno do painel). */
export const RETURN_COOKIE = "echo_voltar";

/** Caminho interno seguro: começa com "/", sem "//", sem barra invertida e sem esquema. Senão, null. */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /^\/[a-z]+:/i.test(value)) return null;
  return value;
}
