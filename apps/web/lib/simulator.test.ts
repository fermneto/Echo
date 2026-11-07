import { describe, expect, it } from "vitest";
import type { AnswerResult } from "@echo/agents";
import { appendMessage, ECHO_TARGET, MAX_MESSAGES, mentionTargets, parseMention } from "./simulator";

const team = [
  { id: "fernando", name: "Fernando Neto", role: "member", availability: { kind: "off" } },
  { id: "eduardo", name: "Eduardo", role: "leader", availability: { kind: "working" } },
  { id: "yan", name: "Yan", role: "member", availability: { kind: "vacation" } },
  { id: "rita", name: "Rita", role: "hr", availability: { kind: "working" } },
];

const reply: AnswerResult = { agentName: "Echo", text: "ok", sources: [], needsOwner: false, usedModel: false, warnings: [] };

describe("mentionTargets", () => {
  it("Echo primeiro, sem quem pergunta e sem o RH", () => {
    const t = mentionTargets(team, "eduardo");
    expect(t.map((x) => x.id)).toEqual([ECHO_TARGET, "fernando", "yan"]);
    expect(t[1]).toEqual({ id: "fernando", handle: "Fernando", agent: "Agente de Fernando", away: true });
  });
});

describe("parseMention", () => {
  const targets = mentionTargets(team, "eduardo");

  it("menção no começo escolhe o agente e sai do texto", () => {
    expect(parseMention("@Fernando posso seguir com a ech-131?", targets, ECHO_TARGET)).toEqual({ target: "fernando", question: "posso seguir com a ech-131?" });
    expect(parseMention("@echo, quem está no expediente?", targets, "yan")).toEqual({ target: ECHO_TARGET, question: "quem está no expediente?" });
  });

  it("menção desconhecida ou no meio fica no texto e vale o alvo escolhido", () => {
    expect(parseMention("@Rita oi", targets, "yan")).toEqual({ target: "yan", question: "@Rita oi" });
    expect(parseMention("falar com @Fernando", targets, ECHO_TARGET)).toEqual({ target: ECHO_TARGET, question: "falar com @Fernando" });
  });
});

describe("appendMessage", () => {
  it("numera e guarda só as últimas mensagens", () => {
    let s = { messages: [] as never[] } as Parameters<typeof appendMessage>[0];
    for (let i = 0; i < MAX_MESSAGES + 2; i++) s = appendMessage(s, { target: ECHO_TARGET, question: `q${i}`, reply, at: "2026-11-06T06:12:00Z" });
    expect(s.messages).toHaveLength(MAX_MESSAGES);
    expect(s.messages.at(-1)).toMatchObject({ id: MAX_MESSAGES + 2, question: `q${MAX_MESSAGES + 1}` });
    expect(s.error).toBeUndefined();
  });
});
