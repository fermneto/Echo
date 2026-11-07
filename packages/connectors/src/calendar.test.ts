import { createVerify, generateKeyPairSync } from "node:crypto";
import { absences, createDb, createPool, identities, orgs, people } from "@echo/db";
import { appRoleUrl } from "@echo/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleCalendar, MicrosoftCalendar, type CalendarSource, type OutOfOffice } from "./calendar.ts";
import { acceptSuggestedWorkHours, confirmCalendarAbsence, currentAbsences, syncCalendar } from "./calendar-sync.ts";

const NOW = new Date("2026-11-07T15:00:00Z");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

describe("GoogleCalendar", () => {
  it("delegação em nome da pessoa e só eventos de fora do escritório, sem título", async () => {
    const urls: string[] = [];
    let assertion = "";
    const fetch = async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        assertion = new URLSearchParams(String(init.body)).get("assertion")!;
        return Response.json({ access_token: "ya29.x", expires_in: 3600 });
      }
      return Response.json({
        items: [
          { id: "e1", eventType: "outOfOffice", status: "confirmed", start: { dateTime: "2026-11-09T12:00:00Z" }, end: { dateTime: "2026-11-09T21:00:00Z" } },
          { id: "e2", eventType: "outOfOffice", status: "cancelled", start: { dateTime: "2026-11-10T12:00:00Z" }, end: { dateTime: "2026-11-10T21:00:00Z" } },
        ],
      });
    };
    const g = new GoogleCalendar({ clientEmail: "echo@proj.iam.gserviceaccount.com", privateKey, fetch, now: () => NOW.getTime() });
    const list = await g.listOutOfOffice("yan@empresa.com", NOW, new Date(NOW.getTime() + 86_400_000));
    expect(list).toEqual([{ id: "e1", start: new Date("2026-11-09T12:00:00Z"), end: new Date("2026-11-09T21:00:00Z") }]);
    const q = new URL(urls[1]!).searchParams;
    expect(q.get("eventTypes")).toBe("outOfOffice");
    expect(q.get("fields")).toBe("items(id,start,end,eventType,status),nextPageToken");
    const [h, p, s] = assertion.split(".");
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ sub: "yan@empresa.com", scope: "https://www.googleapis.com/auth/calendar.events.readonly" });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
    expect(await g.workingHours()).toBeNull();
  });
});

describe("MicrosoftCalendar", () => {
  it("só 'oof' do calendarView, resposta automática agendada e expediente da caixa", async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "eyJ", expires_in: 3600 });
      if (url.includes("calendarView"))
        return Response.json({ value: [
          { id: "m1", showAs: "oof", start: { dateTime: "2026-11-12T00:00:00.0000000" }, end: { dateTime: "2026-11-14T00:00:00.0000000" } },
          { id: "m2", showAs: "busy", start: { dateTime: "2026-11-12T13:00:00.0000000" }, end: { dateTime: "2026-11-12T14:00:00.0000000" } },
        ] });
      if (url.includes("automaticRepliesSetting"))
        return Response.json({ automaticRepliesSetting: { status: "scheduled", scheduledStartDateTime: { dateTime: "2026-11-20T03:00:00.0000000" }, scheduledEndDateTime: { dateTime: "2026-12-01T03:00:00.0000000" } } });
      return Response.json({ workingHours: { daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"], startTime: "08:00:00.0000000", endTime: "17:00:00.0000000", timeZone: { name: "South Africa Standard Time" } } });
    };
    const m = new MicrosoftCalendar({ tenantId: "t1", clientId: "c", clientSecret: "s", fetch, now: () => NOW.getTime() });
    const list = await m.listOutOfOffice("eduardo@empresa.com", NOW, new Date(NOW.getTime() + 60 * 86_400_000));
    expect(list.map((e) => e.id)).toEqual(["m1", "autoreply:2026-11-20T03:00:00.000Z"]);
    expect(urls.find((u) => u.includes("calendarView"))).toContain("$select=id,start,end,showAs");
    expect(urls.join(" ")).not.toMatch(/subject|body|attendees/);
    expect(await m.workingHours("eduardo@empresa.com")).toEqual({ days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", timezone: "Africa/Johannesburg" });
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("syncCalendar (Postgres real, papel comum)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  let appPool: ReturnType<typeof createPool>;
  let app: ReturnType<typeof createDb>;
  let orgId = "";
  let yan = "";
  let edu = "";
  const events: Record<string, OutOfOffice[]> = {};
  const cal: CalendarSource = {
    provider: "google",
    listOutOfOffice: async (user) => {
      if (user === "quebrado@empresa.com") throw new Error("Google 403");
      return events[user] ?? [];
    },
    workingHours: async (user) => (user === "yan@empresa.com" ? { days: [1, 2, 3, 4, 5], start: "10:00", end: "19:00", timezone: "Asia/Tokyo" } : null),
  };

  beforeAll(async () => {
    appPool = createPool(await appRoleUrl(pool, url!), 2, { defaultScope: "none" });
    app = createDb(appPool);
    const [org] = await db.insert(orgs).values({ name: `Teste agenda ${Math.random().toString(36).slice(2, 7)}` }).returning();
    orgId = org!.id;
    const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    const [y] = await db.insert(people).values({ orgId, name: "Yan", timezone: "Asia/Tokyo", workHours: wh }).returning();
    const [e] = await db.insert(people).values({ orgId, name: "Eduardo", timezone: "Africa/Johannesburg", workHours: wh }).returning();
    const [x] = await db.insert(people).values({ orgId, name: "Com erro", timezone: "UTC", workHours: wh }).returning();
    yan = y!.id;
    edu = e!.id;
    await db.insert(identities).values([
      { orgId, personId: yan, platform: "google", externalId: "yan@empresa.com" },
      { orgId, personId: edu, platform: "google", externalId: "eduardo@empresa.com" },
      { orgId, personId: x!.id, platform: "google", externalId: "quebrado@empresa.com" },
    ]);
  });
  afterAll(async () => {
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await Promise.all([pool.end(), appPool.end()]);
  });

  it("curta vale na hora; longa vira sugestão; expediente diferente vira sugestão; erro de uma pessoa não para as outras", async () => {
    events["yan@empresa.com"] = [{ id: "curta", start: new Date("2026-11-09T00:00:00Z"), end: new Date("2026-11-09T09:00:00Z") }];
    events["eduardo@empresa.com"] = [{ id: "ferias", start: new Date("2026-11-16T00:00:00Z"), end: new Date("2026-11-28T00:00:00Z") }];
    const r = await syncCalendar(app, orgId, cal, NOW);
    expect(r).toMatchObject({ people: 3, registered: 2, updated: 0, cancelled: 0, workHoursSuggested: 1 });
    expect(r.errors).toEqual([expect.stringContaining("Google 403")]);
    expect(r.shortRegistered.map((s) => s.personId)).toEqual([yan]);
    expect(r.suggestions.map((s) => s.personId)).toEqual([edu]);
    const rows = await db.select().from(absences).where(eq(absences.orgId, orgId));
    const by = Object.fromEntries(rows.map((a) => [a.calendarEventId, a]));
    expect(by["google:curta"]).toMatchObject({ kind: "ooo", inferred: true, source: "calendar" });
    expect(by["google:curta"]!.confirmedAt).not.toBeNull();
    expect(by["google:ferias"]).toMatchObject({ kind: "vacation", inferred: true, confirmedAt: null });
    const [p] = await db.select().from(people).where(eq(people.id, yan));
    expect(p!.workHoursSuggested).toEqual({ days: [1, 2, 3, 4, 5], start: "10:00", end: "19:00", timezone: "Asia/Tokyo", source: "google" });
    expect(p!.workHours.start).toBe("09:00"); // o cadastro só muda quando a pessoa aceita
  });

  it("rodar de novo não duplica; evento movido atualiza; evento apagado cancela", async () => {
    events["yan@empresa.com"] = [];
    events["eduardo@empresa.com"] = [{ id: "ferias", start: new Date("2026-11-17T00:00:00Z"), end: new Date("2026-11-28T00:00:00Z") }];
    const r = await syncCalendar(app, orgId, cal, NOW);
    expect(r).toMatchObject({ registered: 0, updated: 1, cancelled: 1, workHoursSuggested: 0 });
    const active = await currentAbsences(app, orgId, [yan, edu], NOW);
    expect(active.map((a) => a.personId)).toEqual([edu]);
  });

  it("liderança confirma as férias da agenda uma vez; a pessoa aceita o expediente sugerido", async () => {
    const [f] = await db.select().from(absences).where(and(eq(absences.orgId, orgId), eq(absences.calendarEventId, "google:ferias")));
    expect(await confirmCalendarAbsence(app, orgId, f!.id, yan, NOW)).toBe(true);
    expect(await confirmCalendarAbsence(app, orgId, f!.id, yan, NOW)).toBe(false);
    expect(await acceptSuggestedWorkHours(app, orgId, yan)).toBe(true);
    const [p] = await db.select().from(people).where(eq(people.id, yan));
    expect(p).toMatchObject({ timezone: "Asia/Tokyo", workHours: { days: [1, 2, 3, 4, 5], start: "10:00", end: "19:00" }, workHoursSuggested: null });
  });
});
