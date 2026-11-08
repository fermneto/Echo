import { avatarKey, traitsFromSeed } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { agentIconUrl } from "./slack-answer.ts";

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
});
