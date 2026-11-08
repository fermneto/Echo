import { randomUUID } from "node:crypto";
import { InMemoryQueue, PgBossQueue, QUEUES, type SendOptions } from "@echo/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NIGHT_SINGLETON_SECONDS, registerNight, type NightWiring } from "./night.ts";

const noBatch = { queued: 1, tooLarge: 0, skipped: 0, failed: 0 };
const noResult = { reviewed: 0, noFindings: 0, failed: 0, pending: 0 };

function setup(at: string | (() => Date)) {
  const queue = new InMemoryQueue();
  const calls: string[] = [];
  const sent: { name: string; opts?: SendOptions }[] = [];
  const send = queue.send.bind(queue);
  queue.send = async (name, data, opts) => (sent.push({ name, ...(opts ? { opts } : {}) }), send(name, data, opts));
  const wiring = registerNight(queue, {
    night: {
      prepareAndSubmit: async (o) => (calls.push(`lote:${o}`), noBatch),
      collect: async (o) => (calls.push(`buscar:${o}`), noResult),
    },
    morning: { build: async (o, p, d) => (calls.push(`plano:${o}:${p}:${d}`), { status: "skipped", reason: "x" }) },
    orgIds: async () => ["org"],
    dueMorning: async () => [{ orgId: "org", personId: "fernando", date: "2026-11-09" }],
    nightHourUtc: 5,
    now: typeof at === "string" ? () => new Date(at) : at,
  });
  return { wiring, calls, sent, queue };
}

/** Passadas da agenda a cada 5 min, de `from` até `to` (inclusive). */
const every5min = (from: string, to: string) => {
  const out: Date[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 5 * 60_000) out.push(new Date(t));
  return out;
};

describe("registerNight", () => {
  it("na hora da noite: lote por empresa, com 3 tentativas e 30 min entre elas, um por dia UTC; sempre busca os lotes", async () => {
    const { wiring, calls, sent } = setup("2026-11-09T05:02:00Z");
    expect(await (await wiring).tick()).toEqual({ night: 1, morning: 1 });
    expect(calls).toEqual(["lote:org", "buscar:org", "plano:org:fernando:2026-11-09"]);
    expect(sent.find((s) => s.name === QUEUES.nightReview)?.opts).toEqual({ singletonKey: "org:2026-11-09", singletonSeconds: 86_400, retryLimit: 2, retryDelaySeconds: 1800 });
  });

  it("fora da hora da noite, só busca os lotes e monta os planos", async () => {
    const { wiring, calls } = setup("2026-11-09T11:45:00Z");
    expect(await (await wiring).tick()).toEqual({ night: 0, morning: 1 });
    expect(calls).toEqual(["buscar:org", "plano:org:fernando:2026-11-09"]);
  });

  it("agenda a cada 5 min por dois dias: um lote por noite, só dentro da hora", async () => {
    let at = new Date(0);
    const { wiring, calls } = setup(() => at);
    const night = await wiring;
    const ticks = [...every5min("2026-11-09T04:30:00Z", "2026-11-09T06:30:00Z"), ...every5min("2026-11-10T04:55:00Z", "2026-11-10T06:00:00Z")];
    const queued: string[] = [];
    for (const t of ticks) {
      at = t;
      if ((await night.tick()).night) queued.push(t.toISOString());
    }
    expect(queued).toEqual(["2026-11-09T05:00:00.000Z", "2026-11-10T05:00:00.000Z"]);
    expect(calls.filter((c) => c === "lote:org")).toHaveLength(2);
    // A busca em toda passada é conferida com o pg-boss abaixo: a fila em memória recusa chave repetida sempre.
  });
});

// Fila real (pg-boss): a chave do dia sozinha não bastava, porque a fila de política padrão não recusa chave
// repetida. Aqui, dois workers (deploy com os dois no ar) passam a agenda a cada 5 min a hora inteira.
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("registerNight com pg-boss (Postgres real)", () => {
  const workers = [new PgBossQueue(url!, { pollingIntervalSeconds: 0.5 }), new PgBossQueue(url!, { pollingIntervalSeconds: 0.5 })];
  const orgId = `org-teste-${randomUUID()}`;
  const day = new Date().toISOString().slice(0, 10);
  const lotes: string[] = [];
  const buscas: string[] = [];
  let at = new Date(`${day}T04:55:00Z`);

  const wiring = (w: string): NightWiring => ({
    night: {
      prepareAndSubmit: async (o) => {
        if (o === orgId) lotes.push(w);
        return noBatch;
      },
      collect: async (o) => {
        if (o === orgId) buscas.push(w);
        return noResult;
      },
    },
    morning: { build: async () => ({ status: "skipped", reason: "x" }) },
    orgIds: async () => [orgId],
    dueMorning: async () => [],
    nightHourUtc: 5,
    now: () => at,
  });
  const until = async (ok: () => boolean, ms = 15_000) => {
    for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 100));
    expect(ok()).toBe(true);
  };

  beforeAll(async () => {
    for (const q of workers) await q.start();
  }, 30_000);
  afterAll(async () => {
    for (const q of workers) await q.stop();
  });

  it("um só job da noite por empresa no dia, com dois workers e passadas a cada 5 min; o manual mais cedo não ocupa a vaga", async () => {
    const [a, b] = await Promise.all(workers.map((q, i) => registerNight(q, wiring(`w${i}`))));

    // Disparo manual mais cedo (chave do minuto, como em noite:agora): roda e não ocupa a chave do dia.
    expect(await workers[0]!.send(QUEUES.nightReview, { orgId }, { singletonKey: `${orgId}:agora:${day}T01:38` })).not.toBeNull();
    await until(() => lotes.length === 1);

    let night = 0;
    for (const t of every5min(`${day}T04:55:00Z`, `${day}T06:00:00Z`)) {
      at = t;
      const [ra, rb] = await Promise.all([a!.tick(), b!.tick()]);
      night += ra.night + rb.night;
      // Dá tempo de o job da passada terminar: a vaga do dia continua ocupada depois disso.
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(night).toBe(1);
    await until(() => lotes.length === 2);
    await new Promise((r) => setTimeout(r, 1500));
    expect(lotes).toHaveLength(2);

    // A busca dos lotes vai para a fila a cada passada, uma por janela (DEDUPE_SECONDS.perScan, relógio do banco):
    // as passadas deste teste cabem em poucos segundos, então os dois workers põem uma só, e ela chega a um deles.
    await until(() => buscas.length >= 1);
    await new Promise((r) => setTimeout(r, 1000));
    expect(buscas).toHaveLength(1);

    // Mesmo terminado, o job do dia segue recusando outro com a mesma chave.
    expect(await workers[1]!.send(QUEUES.nightReview, { orgId }, { singletonKey: `${orgId}:${day}`, singletonSeconds: NIGHT_SINGLETON_SECONDS })).toBeNull();
  }, 60_000);
});
