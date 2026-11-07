// Agenda (etapa 18): só "fora do escritório", horário e expediente. Reuniões estão fora do produto:
// nunca pedimos título, descrição ou participantes (os campos nem vêm na resposta).
import { createSign } from "node:crypto";
import { RefreshingToken } from "./tokens.ts";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OutOfOffice {
  /** Id estável do evento na agenda (ou da resposta automática). */
  id: string;
  start: Date;
  end: Date;
}

export interface WorkingHours {
  days: number[]; // 0 = domingo
  start: string; // "09:00"
  end: string;
  timezone: string; // IANA
}

/** Porta da agenda. `user` é a conta da pessoa na agenda da empresa (e-mail ou id). */
export interface CalendarSource {
  readonly provider: "google" | "microsoft";
  listOutOfOffice(user: string, from: Date, to: Date): Promise<OutOfOffice[]>;
  /** Expediente da agenda, quando a plataforma informa. Vira só sugestão. */
  workingHours(user: string): Promise<WorkingHours | null>;
}

export class CalendarApiError extends Error {
  override name = "CalendarApiError";
  constructor(
    readonly provider: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${provider} ${status}: ${detail}`);
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

// ---------------------------------------------------------------- Google Calendar

export interface GoogleCalendarOptions {
  /** Conta de serviço com delegação no domínio (o administrador do Workspace autoriza o escopo). */
  clientEmail: string;
  privateKey: string;
  fetch?: FetchLike;
  now?: () => number;
}

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

export class GoogleCalendar implements CalendarSource {
  readonly provider = "google" as const;
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly tokens = new Map<string, RefreshingToken>();

  constructor(private readonly opts: GoogleCalendarOptions) {
    this.fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.now = opts.now ?? Date.now;
  }

  /** Token de 1 hora em nome da pessoa (delegação), um por pessoa, renovado num só lugar. */
  private token(user: string): Promise<string> {
    let t = this.tokens.get(user);
    if (!t) {
      t = new RefreshingToken(async () => {
        const iat = Math.floor(this.now() / 1000);
        const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        const body = b64url(JSON.stringify({ iss: this.opts.clientEmail, sub: user, scope: GOOGLE_SCOPE, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
        const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(this.opts.privateKey.replace(/\\n/g, "\n"));
        const res = await this.fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${b64url(sig)}` }).toString(),
          signal: AbortSignal.timeout(10_000),
        });
        const d = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
        if (!res.ok || !d.access_token) throw new CalendarApiError("google", res.status, d.error ?? "token recusado");
        return { token: d.access_token, expiresAt: this.now() + (d.expires_in ?? 3600) * 1000 };
      }, 5 * 60_000, this.now);
      this.tokens.set(user, t);
    }
    return t.get();
  }

  async listOutOfOffice(user: string, from: Date, to: Date): Promise<OutOfOffice[]> {
    const out: OutOfOffice[] = [];
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({
        eventTypes: "outOfOffice", // o tipo é filtrado na própria consulta
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: "true",
        maxResults: "250",
        // Só estes campos voltam: nada de título, descrição ou participantes.
        fields: "items(id,start,end,eventType,status),nextPageToken",
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await this.fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
        headers: { authorization: `Bearer ${await this.token(user)}` },
        signal: AbortSignal.timeout(10_000),
      });
      const d = (await res.json().catch(() => ({}))) as { items?: any[]; nextPageToken?: string; error?: { message?: string } };
      if (!res.ok) throw new CalendarApiError("google", res.status, d.error?.message ?? "falha na consulta");
      for (const e of d.items ?? []) {
        if (e.status === "cancelled" || e.eventType !== "outOfOffice") continue;
        const start = e.start?.dateTime ?? e.start?.date;
        const end = e.end?.dateTime ?? e.end?.date;
        if (start && end) out.push({ id: e.id, start: new Date(start), end: new Date(end) });
      }
      if (!d.nextPageToken) break;
      pageToken = d.nextPageToken;
    }
    return out;
  }

  /** A API do Google Agenda não expõe o horário de trabalho: sem sugestão por aqui. */
  async workingHours(): Promise<WorkingHours | null> {
    return null;
  }
}

// ---------------------------------------------------------------- Microsoft 365 (Outlook)

export interface MicrosoftCalendarOptions {
  /** App multi-tenant com permissões de aplicativo Calendars.ReadBasic e MailboxSettings.Read, com consentimento do administrador. */
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => number;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Fusos do Windows mais comuns nos clientes → IANA. Fuso desconhecido: sem sugestão. */
const WINDOWS_TZ: Record<string, string> = {
  "E. South America Standard Time": "America/Sao_Paulo",
  "SA Eastern Standard Time": "America/Fortaleza",
  "SE Asia Standard Time": "Asia/Bangkok",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Tokyo Standard Time": "Asia/Tokyo",
  "GMT Standard Time": "Europe/London",
  "Eastern Standard Time": "America/New_York",
  "Pacific Standard Time": "America/Los_Angeles",
  UTC: "UTC",
};

export class MicrosoftCalendar implements CalendarSource {
  readonly provider = "microsoft" as const;
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly token: RefreshingToken;

  constructor(private readonly opts: MicrosoftCalendarOptions) {
    this.fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.now = opts.now ?? Date.now;
    this.token = new RefreshingToken(async () => {
      const res = await this.fetch(`https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: opts.clientId, client_secret: opts.clientSecret, scope: "https://graph.microsoft.com/.default" }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const d = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
      if (!res.ok || !d.access_token) throw new CalendarApiError("microsoft", res.status, d.error_description?.split("\r\n")[0] ?? "token recusado");
      return { token: d.access_token, expiresAt: this.now() + (d.expires_in ?? 3600) * 1000 };
    }, 5 * 60_000, this.now);
  }

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetch(url, {
      headers: { authorization: `Bearer ${await this.token.get()}`, prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(10_000),
    });
    const d = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new CalendarApiError("microsoft", res.status, d.error?.message ?? "falha na consulta");
    return d;
  }

  async listOutOfOffice(user: string, from: Date, to: Date): Promise<OutOfOffice[]> {
    const out: OutOfOffice[] = [];
    const u = encodeURIComponent(user);
    // Só id, horário e "mostrar como": o assunto nem é pedido.
    let next: string | undefined = `https://graph.microsoft.com/v1.0/users/${u}/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$select=id,start,end,showAs&$top=100`;
    for (let page = 0; next && page < 10; page++) {
      const d: { value: any[]; "@odata.nextLink"?: string } = await this.get(next);
      for (const e of d.value) {
        if (e.showAs !== "oof") continue;
        out.push({ id: e.id, start: new Date(`${e.start.dateTime}Z`), end: new Date(`${e.end.dateTime}Z`) });
      }
      next = d["@odata.nextLink"];
    }
    // Resposta automática agendada também conta como fora do escritório.
    const s = await this.get<{ automaticRepliesSetting?: { status?: string; scheduledStartDateTime?: { dateTime: string }; scheduledEndDateTime?: { dateTime: string } } }>(
      `https://graph.microsoft.com/v1.0/users/${u}/mailboxSettings?$select=automaticRepliesSetting`,
    );
    const ar = s.automaticRepliesSetting;
    if (ar?.status === "scheduled" && ar.scheduledStartDateTime && ar.scheduledEndDateTime) {
      const start = new Date(`${ar.scheduledStartDateTime.dateTime.replace(/Z$/, "")}Z`);
      const end = new Date(`${ar.scheduledEndDateTime.dateTime.replace(/Z$/, "")}Z`);
      if (end > from && start < to) out.push({ id: `autoreply:${start.toISOString()}`, start, end });
    }
    return out;
  }

  async workingHours(user: string): Promise<WorkingHours | null> {
    const s = await this.get<{ workingHours?: { daysOfWeek?: string[]; startTime?: string; endTime?: string; timeZone?: { name?: string } } }>(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/mailboxSettings?$select=workingHours`,
    );
    const w = s.workingHours;
    const tzName = w?.timeZone?.name ?? "";
    const timezone = tzName.includes("/") ? tzName : WINDOWS_TZ[tzName];
    if (!w?.daysOfWeek?.length || !w.startTime || !w.endTime || !timezone) return null;
    return {
      days: w.daysOfWeek.map((d) => WEEKDAYS.indexOf(d.toLowerCase())).filter((d) => d >= 0).sort(),
      start: w.startTime.slice(0, 5),
      end: w.endTime.slice(0, 5),
      timezone,
    };
  }
}
