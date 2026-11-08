import { describe, expect, it, vi } from "vitest";
import { membersOf, type SlackDirectory, slackDirectoryFor } from "./slack-directory";

const ok: SlackDirectory = { status: "ok", members: [{ id: "U0ANA0001", name: "Ana" }] };

describe("lista de membros do Slack", () => {
  it("a sessão de demonstração não chama o leitor do Slack, nem para o RH", async () => {
    const read = vi.fn(async () => ok);
    const dir = await slackDirectoryFor({ demo: true, canLinkSlack: true, read });
    expect(read).not.toHaveBeenCalled();
    expect(dir).toEqual({ status: "demo", members: [] });
    expect(membersOf(dir)).toEqual([]);
  });

  it("quem não liga o Slack (liderança) também não lê a workspace", async () => {
    const read = vi.fn(async () => ok);
    expect(await slackDirectoryFor({ demo: false, canLinkSlack: false, read })).toEqual({ status: "off" });
    expect(read).not.toHaveBeenCalled();
  });

  it("fora da demonstração, o RH lê a lista; falha e desligado ficam sem lista", async () => {
    const read = vi.fn(async () => ok);
    expect(membersOf(await slackDirectoryFor({ demo: false, canLinkSlack: true, read }))).toEqual(ok.status === "ok" ? ok.members : []);
    expect(read).toHaveBeenCalledOnce();
    expect(membersOf({ status: "failed" })).toBeNull();
    expect(membersOf({ status: "off" })).toBeNull();
  });
});
