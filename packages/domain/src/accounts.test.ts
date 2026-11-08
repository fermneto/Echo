import { describe, expect, it } from "vitest";
import { parseAccounts } from "./accounts.ts";

describe("contas da pessoa", () => {
  it("normaliza Slack, GitHub e Linear; vazio = sem conta", () => {
    expect(parseAccounts({ slack: " u07abc123 ", github: "https://github.com/Fernando-M/", linear: "6F1C2D3E-1111-4222-8333-444455556666" })).toEqual({
      ok: true,
      links: [
        { platform: "slack", externalId: "U07ABC123", login: null },
        { platform: "github", externalId: "login:fernando-m", login: "Fernando-M" },
        { platform: "linear", externalId: "6f1c2d3e-1111-4222-8333-444455556666", login: null },
      ],
    });
    expect(parseAccounts({ github: "@yan" })).toEqual({ ok: true, links: [{ platform: "github", externalId: "login:yan", login: "yan" }] });
    expect(parseAccounts({ slack: "", github: "  ", linear: null })).toEqual({ ok: true, links: [] });
  });

  it("recusa formato errado com a mensagem para a tela", () => {
    expect(parseAccounts({ slack: "fernando" })).toMatchObject({ ok: false, error: expect.stringContaining("Slack") });
    expect(parseAccounts({ slack: "C0123456" })).toMatchObject({ ok: false });
    for (const g of ["-yan", "yan-", "ya--n", "a b", "x".repeat(40)]) expect(parseAccounts({ github: g })).toMatchObject({ ok: false, error: expect.stringContaining("GitHub") });
    expect(parseAccounts({ linear: "eduardo@empresa.com" })).toMatchObject({ ok: false, error: expect.stringContaining("Linear") });
  });
});
