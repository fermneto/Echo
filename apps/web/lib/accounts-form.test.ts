import { describe, expect, it } from "vitest";
import { conflictMessage, parseAccountsForm } from "./accounts-form";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};

describe("contas no formulário", () => {
  it("lê os três campos; vazio = sem conta", () => {
    expect(parseAccountsForm(form({ conta_slack: "U0ANA0001", conta_github: "@ana", conta_linear: "" }))).toEqual({
      ok: true,
      links: [
        { platform: "slack", externalId: "U0ANA0001", login: null },
        { platform: "github", externalId: "login:ana", login: "ana" },
      ],
    });
    expect(parseAccountsForm(form({}))).toEqual({ ok: true, links: [] });
  });

  it("com a lista da workspace, a conta do Slack precisa estar nela; sem lista, vale o formato", () => {
    const members = [{ id: "U0ANA0001" }];
    expect(parseAccountsForm(form({ conta_slack: "U0ANA0001" }), members).ok).toBe(true);
    expect(parseAccountsForm(form({ conta_slack: "U0OUTRA01" }), members)).toEqual({ ok: false, error: "Essa conta do Slack não está na workspace ligada à empresa." });
    expect(parseAccountsForm(form({ conta_slack: "U0OUTRA01" }), null).ok).toBe(true);
    expect(parseAccountsForm(form({ conta_slack: "ana" })).ok).toBe(false);
  });

  it("conta de outra pessoa: diz de quem é; na corrida, sem nome", () => {
    expect(conflictMessage("slack", "Ana")).toBe("Essa conta do Slack já está ligada a Ana. Tire de lá primeiro, na ficha de Ana.");
    expect(conflictMessage("github", null)).toBe("Essa conta do GitHub acabou de ser ligada a outra pessoa. Confira as contas e tente de novo.");
  });

  it("só as plataformas permitidas: o campo do Slack vindo da liderança é recusado, mesmo vazio", () => {
    const leader = ["github", "linear"] as const;
    expect(parseAccountsForm(form({ conta_github: "ana" }), null, leader)).toEqual({ ok: true, links: [{ platform: "github", externalId: "login:ana", login: "ana" }] });
    expect(parseAccountsForm(form({ conta_slack: "U0ANA0001", conta_github: "ana" }), null, leader)).toEqual({ ok: false, error: "Só o RH liga ou troca a conta do Slack: é por ela que a pessoa entra no painel." });
    expect(parseAccountsForm(form({ conta_slack: "" }), null, leader).ok).toBe(false);
    expect(parseAccountsForm(form({ conta_github: "ana" }), null, []).ok).toBe(false);
  });
});
