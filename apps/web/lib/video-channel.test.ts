import { describe, expect, it } from "vitest";
import { canEditVideoChannel, editableVideoChannels, ORG_TARGET } from "./video-channel";

const view = { org: "C0EMPRESA1", teams: [{ id: "t1", name: "Produto", channel: "C0PRODUTO1" }, { id: "t2", name: "Pagamentos", channel: null }] };

describe("canal do vídeo da semana na Configuração", () => {
  it("RH muda o de todas as equipes e o da empresa", () => {
    expect(editableVideoChannels({ role: "hr" }, view).map((r) => r.target)).toEqual(["t1", "t2", ORG_TARGET]);
  });

  it("liderança muda só o da própria equipe; sem equipe, ou empresa sem equipes, o da empresa", () => {
    expect(editableVideoChannels({ role: "leader", teamId: "t1" }, view).map((r) => [r.target, r.channel])).toEqual([["t1", "C0PRODUTO1"]]);
    expect(editableVideoChannels({ role: "leader" }, view).map((r) => r.target)).toEqual([ORG_TARGET]);
    expect(editableVideoChannels({ role: "leader", teamId: "t1" }, { org: null, teams: [] }).map((r) => r.target)).toEqual([ORG_TARGET]);
    expect(canEditVideoChannel({ role: "leader", teamId: "t1" }, view, "t2")).toBe(false);
    expect(canEditVideoChannel({ role: "leader", teamId: "t1" }, view, ORG_TARGET)).toBe(false);
  });

  it("membro não muda nada", () => {
    expect(editableVideoChannels({ role: "member", teamId: "t1" }, view)).toEqual([]);
    expect(canEditVideoChannel({ role: "member", teamId: "t1" }, view, "t1")).toBe(false);
  });
});
