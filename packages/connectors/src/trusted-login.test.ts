// Quem responde por um commit no espelho: só commit verificado, e nunca pelo e-mail do autor.
import { describe, expect, it } from "vitest";
import { trustedLogin, type CommitIdentity } from "./index.ts";

const c = (author: string | null, committer: string | null, verified: boolean | undefined): CommitIdentity => ({
  author: author ? { login: author } : null,
  committer: committer ? { login: committer } : null,
  commit: { verification: verified === undefined ? null : { verified } },
});

describe("trustedLogin", () => {
  it("commit verificado: vale quem fez o commit (dono da assinatura), não o autor declarado", () => {
    expect(trustedLogin(c("fernando", "eduardo", true))).toBe("eduardo");
    expect(trustedLogin(c("fernando", "fernando", true))).toBe("fernando");
  });

  it("edição pelo site do GitHub (web-flow): vale a pessoa logada, que é a autora", () => {
    expect(trustedLogin(c("fernando", "web-flow", true))).toBe("fernando");
    expect(trustedLogin(c(null, "web-flow", true))).toBeNull();
  });

  it("sem assinatura verificada ou sem conta: ninguém", () => {
    expect(trustedLogin(c("fernando", "fernando", false))).toBeNull();
    expect(trustedLogin(c("fernando", "fernando", undefined))).toBeNull();
    expect(trustedLogin(c("fernando", null, true))).toBeNull();
  });
});
