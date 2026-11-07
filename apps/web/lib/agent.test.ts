import type { AnswerResult } from "@echo/agents";
import { describe, expect, it } from "vitest";
import { askAgent, panelRequest } from "./agent";

describe("pergunta do painel no fluxo real", () => {
  it("persona da demo vira a pessoa e a empresa do seed; quem entrou pelo Slack segue com o id real", () => {
    expect(panelRequest({ orgId: "demo", askerId: "eduardo", ownerId: "fernando", question: "posso seguir com a ech-131?" })).toEqual({
      orgId: "00000000-0000-4000-8000-000000000001",
      askerId: "00000000-0000-4000-8000-000000000102",
      ownerId: "00000000-0000-4000-8000-000000000101",
      text: "posso seguir com a ech-131?",
      channel: "painel",
    });
    const real = panelRequest({ orgId: "org-1", askerId: "p-1", question: "quem está livre?" });
    expect(real).toEqual({ orgId: "org-1", askerId: "p-1", text: "quem está livre?", channel: "painel" });
    expect("ownerId" in real).toBe(false); // Echo da equipe
  });

  it("devolve a resposta do fluxo; falha vira mensagem, sem resposta simulada", async () => {
    const reply: AnswerResult = { agentName: "Agente de Fernando", text: "Sim.", sources: [], needsOwner: false, usedModel: true, warnings: [] };
    expect(await askAgent(panelRequest({ orgId: "demo", askerId: "eduardo", ownerId: "fernando", question: "oi" }), async () => reply)).toEqual({ ok: true, reply });
    const failed = await askAgent(panelRequest({ orgId: "demo", askerId: "eduardo", question: "oi" }), async () => {
      throw new Error("banco fora");
    });
    expect(failed).toEqual({ ok: false, error: "O agente não conseguiu responder agora. Tente de novo em instantes." });
  });
});
