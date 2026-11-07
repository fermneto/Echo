// Resumo da ausência (etapa 13, F5b): agrupado, privado pelo outbox, sem modelo, linhas apagadas na entrega e
// uma linha em agent_runs a cada execução.
import type { OutboxAction } from "@echo/actions";
import { type DigestItem, FixedClock, type Person } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import { createAwayDigest, type DigestStore } from "./away-digest.ts";
import type { AgentData } from "./data.ts";

const NOW = new Date("2026-11-09T12:05:00Z"); // segunda, 09h05 em Fortaleza
const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "org", name, role: "member", timezone: "America/Fortaleza", workHours: hours, skills: [], areas: [], active: true, ...extra });
const people = [person("fernando", "Fernando Neto"), person("eduardo", "Eduardo"), person("marina", "Marina", { role: "leader" }), person("rita", "Rita", { role: "hr" })];
const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function setup(items: DigestItem[]) {
  const pending = new Map(items.map((i) => [i.id, i]));
  const delivered: string[] = [];
  const outbox: OutboxAction[] = [];
  const recorder = new LogRunRecorder();
  const store: DigestStore = {
    lastSentAt: async () => null,
    pending: async () => [...pending.values()],
    markDelivered: async (ids) => {
      for (const id of ids) if (pending.delete(id)) delivered.push(id);
      return ids.length;
    },
    purge: async () => 0,
  };
  const flow = createAwayDigest({
    data: () => ({ people: async () => people }) as unknown as AgentData,
    store: () => store,
    outbox: () => ({
      enqueue: async (a) => {
        const dup = outbox.some((x) => x.idempotencyKey === a.idempotencyKey);
        if (!dup) outbox.push(a);
        return { id: a.idempotencyKey, duplicate: dup };
      },
    }),
    recorder,
    clock: new FixedClock(NOW),
    webUrl: "https://echo.test/",
  });
  return { flow, outbox, delivered, pending, runs: recorder.runs };
}

const cena: DigestItem[] = [
  { id: "q1", askerId: "marina", kind: "reuniao", state: "answered", needsOwner: true, request: "Podemos marcar uma reunião de alinhamento na quinta?", reply: "Fernando decide na volta.", createdAt: at(10) },
  { id: "q2", askerId: "eduardo", kind: "nenhum", state: "answered", needsOwner: false, request: "posso seguir com a branch ech-131-api-v2?", reply: "Sim, liberada na nota do dia confirmada.", createdAt: at(9) },
  { id: "q3", askerId: "eduardo", kind: "nenhum", state: "answered", needsOwner: false, request: "qual o estado do ECH-128?", reply: "Em andamento, branch reservada.", createdAt: at(8) },
];

describe("resumo da ausência", () => {
  it("agrupa propostas, decisões, sem resposta e respondidas e manda em privado pelo outbox", async () => {
    const { flow, outbox, delivered, runs } = setup(cena);
    const r = await flow.send("org", "fernando", { date: "2026-11-09", slot: "inicio" });
    expect(r).toEqual({ status: "sent", items: 3, sections: { propostas: 1, decisoes: 0, sem_resposta: 0, respondidas: 2 } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: "slack.dm", target: "person:fernando", payload: { personId: "fernando" }, idempotencyKey: "away_digest:fernando:2026-11-09:inicio" });
    const text = (outbox[0]!.payload as { text: string }).text;
    expect(text.split("\n")).toEqual([
      "*Enquanto você estava fora*",
      "*Propostas (1):*",
      "• Marina: Podemos marcar uma reunião de alinhamento na quinta?",
      "_O agente não aceitou, recusou nem marcou nada por você._",
      "*Decisões (0)*",
      "*Sem resposta (0)*",
      "*Respondidas (2):*",
      "• Eduardo: posso seguir com a branch ech-131-api-v2? → Sim, liberada na nota do dia confirmada.",
      "• Eduardo: qual o estado do ECH-128? → Em andamento, branch reservada.",
    ]);
    expect(JSON.stringify(outbox[0]!.payload)).toContain("https://echo.test/plano");
    // Entregue: as linhas somem.
    expect(delivered).toEqual(["q1", "q2", "q3"]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ flow: "away_digest", result: "ok", tools: ["slack.dm"] });
    expect(runs[0]!.model).toBeUndefined();
  });

  it("até 20 itens por seção, o resto no painel", async () => {
    const many = Array.from({ length: 25 }, (_, i): DigestItem => ({ id: `r${i}`, askerId: "eduardo", kind: "nenhum", state: "failed", needsOwner: false, request: `pergunta ${i}`, createdAt: at(30 - i) }));
    const { flow, outbox } = setup(many);
    await flow.send("org", "fernando", { date: "2026-11-09", slot: "fim" });
    const text = (outbox[0]!.payload as { text: string }).text;
    expect(text).toContain("*Sem resposta (25):*");
    expect(text.match(/^• Eduardo: pergunta/gm)).toHaveLength(20);
    expect(text).toContain("E mais 5 no painel.");
  });

  it("sem nada pendente, não sai mensagem; o mesmo momento não sai duas vezes", async () => {
    const empty = setup([]);
    expect(await empty.flow.send("org", "fernando", { date: "2026-11-09", slot: "inicio" })).toMatchObject({ status: "skipped" });
    expect(empty.outbox).toHaveLength(0);
    expect(empty.runs[0]).toMatchObject({ flow: "away_digest", result: "skipped" });

    const { flow, outbox, pending, delivered } = setup(cena);
    await flow.send("org", "fernando", { date: "2026-11-09", slot: "inicio" });
    pending.set("q9", { ...cena[0]!, id: "q9" });
    expect(await flow.send("org", "fernando", { date: "2026-11-09", slot: "inicio" })).toEqual({ status: "skipped", reason: "resumo deste momento já enviado" });
    expect(outbox).toHaveLength(1);
    expect(delivered).not.toContain("q9"); // fica para o próximo resumo
  });

  it("RH e quem foi desligado não recebem", async () => {
    const { flow, outbox } = setup(cena);
    expect(await flow.send("org", "rita", { date: "2026-11-09", slot: "inicio" })).toMatchObject({ status: "skipped" });
    expect(await flow.send("org", "ninguem", { date: "2026-11-09", slot: "inicio" })).toMatchObject({ status: "skipped" });
    expect(outbox).toHaveLength(0);
  });
});
