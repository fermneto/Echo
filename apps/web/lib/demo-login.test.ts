import { describe, expect, it } from "vitest";
import { checkDemoLogin, DEMO_PASSWORD, demoPersonaParam, demoUser, demoUsernames } from "./demo-login";

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

  it("dica da entrada lista os usuários da demonstração", () => {
    const users = demoUsernames();
    expect(users.slice(0, 4)).toEqual(["fernando", "eduardo", "yan", "marina"]);
    expect(new Set(users).size).toBe(users.length);
  });

  it("?persona da landing preenche o usuário só com persona conhecida", () => {
    expect(demoPersonaParam("eduardo")).toBe("eduardo");
    expect(demoPersonaParam(" Eduardo ")).toBe("eduardo");
    expect(demoPersonaParam(["yan", "rita"])).toBe("yan");
    expect(demoPersonaParam("ninguem")).toBeUndefined();
    expect(demoPersonaParam("")).toBeUndefined();
    expect(demoPersonaParam(undefined)).toBeUndefined();
    expect(demoPersonaParam("<script>")).toBeUndefined();
    expect(demoPersonaParam("e".repeat(200))).toBeUndefined();
  });
});
