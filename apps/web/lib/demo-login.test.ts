import { describe, expect, it } from "vitest";
import { checkDemoLogin, DEMO_PASSWORD, demoUser, demoUsernames } from "./demo-login";

describe("login da demonstração", () => {
  it("usuário pelo id ou pelo nome, sem diferença de maiúscula nem de acento", () => {
    expect(demoUser("fernando")?.id).toBe("fernando");
    expect(demoUser("  Fernando ")?.id).toBe("fernando");
    expect(demoUser("RITA")?.id).toBe("rita");
    expect(demoUser("ninguem")).toBeUndefined();
    expect(demoUser("")).toBeUndefined();
  });

  it("senha echo para todos; senha errada ou usuário desconhecido não entram", () => {
    expect(DEMO_PASSWORD).toBe("echo");
    for (const u of demoUsernames()) expect(checkDemoLogin(u, "echo")?.id).toBe(u);
    expect(checkDemoLogin("fernando", "Echo")).toBeNull();
    expect(checkDemoLogin("fernando", "")).toBeNull();
    expect(checkDemoLogin("fernando", "echo ")).toBeNull();
    expect(checkDemoLogin("ninguem", "echo")).toBeNull();
  });
});
