import { avatarKey, traitsFromSeed } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { agentIconUrl, outboxAgentIcon } from "./agent-icon.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

describe("ícone do agente no Slack", () => {
  it("gêmeo: bonequinho da pessoa, com a chave dos traços no endereço", () => {
    const avatar = { ...traitsFromSeed("x"), hair: "afro" };
    expect(agentIconUrl("https://echo.exemplo.com/", ORG, { id: ID, avatar })).toBe(`https://echo.exemplo.com/api/avatar/${ORG}/${ID}?v=${avatarKey(avatar as never)}`);
  });
  it("sem traços gravados: os mesmos traços estáveis do painel", () => {
    expect(agentIconUrl("https://echo.exemplo.com", ORG, { id: ID, avatar: null })).toContain(`?v=${avatarKey(traitsFromSeed(ID))}`);
  });
  it("sem dono: o ícone do Echo", () => {
    expect(agentIconUrl("https://echo.exemplo.com", ORG, undefined)).toMatch(/\/api\/avatar\/echo\?v=\d+$/);
  });
  it("sem https público (localhost), fica o ícone do app", () => {
    expect(agentIconUrl("http://localhost:3000", ORG, { id: ID })).toBeUndefined();
    expect(agentIconUrl(undefined, ORG, undefined)).toBeUndefined();
  });

  it("outbox: o bonequinho do dono, o do Echo sem dono, e nada para quem não é da empresa", async () => {
    const reads: string[] = [];
    const avatar = { ...traitsFromSeed("x"), hair: "bun" };
    const icon = outboxAgentIcon("https://echo.exemplo.com", async (_org, id) => (reads.push(id), id === ID ? avatar : undefined));
    expect(await icon(ORG, ID)).toBe(`https://echo.exemplo.com/api/avatar/${ORG}/${ID}?v=${avatarKey(avatar as never)}`);
    expect(await icon(ORG)).toMatch(/\/api\/avatar\/echo\?v=\d+$/);
    expect(await icon(ORG, "33333333-3333-4333-8333-333333333333")).toBeUndefined();
    expect(reads).toEqual([ID, "33333333-3333-4333-8333-333333333333"]);
  });

  it("outbox sem https público: nem consulta o banco", async () => {
    let reads = 0;
    const icon = outboxAgentIcon("http://localhost:3000", async () => (reads++, null));
    expect(await icon(ORG, ID)).toBeUndefined();
    expect(reads).toBe(0);
  });
});
