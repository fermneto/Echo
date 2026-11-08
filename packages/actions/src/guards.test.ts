// Conferências do executor sem banco: branch do rascunho, diff de novo na hora de escrever e linha de auditoria.
import { describe, expect, it } from "vitest";
import { approvalAudit, draftPrRefusal, type DraftPrPayload } from "./guards.ts";

const patch = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
const draft: DraftPrPayload = { repo: "org/app", prNumber: 44, base: "ech-128", baseSha: "sha44", branch: "echo/fix-pr-44", title: "t", body: "b", patch, prFiles: ["src/a.ts"] };

describe("rascunho da correção no executor", () => {
  it("passa só com a branch echo/fix-pr-N do PR e o diff conferido", () => {
    expect(draftPrRefusal(draft)).toBeNull();
  });

  it("recusa branch que não é do Echo, a base, a de outro PR ou com prefixo forjado", () => {
    expect(draftPrRefusal({ ...draft, branch: "ech-128" })).toMatch(/^branch recusada: branch ech-128 não é do Echo/);
    expect(draftPrRefusal({ ...draft, branch: "main" })).toMatch(/^branch recusada/);
    expect(draftPrRefusal({ ...draft, branch: "echo/fix-pr-44", base: "echo/fix-pr-44" })).toMatch(/base ou a padrão/);
    expect(draftPrRefusal({ ...draft, branch: "echo/fix-pr-45" })).toMatch(/não é a do PR #44/);
    expect(draftPrRefusal({ ...draft, branch: "echo/fix-pr-44x" })).toMatch(/^branch recusada/);
  });

  it("recusa diff malformado, fora do PR ou sem a lista de arquivos", () => {
    const bypass = ["diff --git X", "@@ -0,0 +1,400 @@", ...Array.from({ length: 400 }, (_, i) => `+${i}`), patch].join("\n");
    expect(draftPrRefusal({ ...draft, patch: bypass })).toBe("diff recusado: diff malformado: cabeçalho de arquivo inválido na linha 1");
    expect(draftPrRefusal({ ...draft, prFiles: ["src/b.ts"] })).toBe("diff recusado: arquivo fora do PR: src/a.ts");
    const { prFiles: _p, ...semArquivos } = draft;
    expect(draftPrRefusal(semArquivos)).toMatch(/não traz os arquivos do PR/);
  });
});

describe("auditoria da aprovação", () => {
  it("registra a pessoa e por onde aprovou", () => {
    expect(approvalAudit({ orgId: "o1", approverId: "p1", type: "github.merge_fix", target: "github:org/app#45", source: "slack" })).toEqual({ orgId: "o1", actor: "person:p1", action: "approve:github.merge_fix:slack", target: "github:org/app#45" });
    expect(approvalAudit({ orgId: "o1", approverId: "p1", type: "linear.assign", target: "linear:ECH-1" }).action).toBe("approve:linear.assign");
  });
});
