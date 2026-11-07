import { describe, expect, it } from "vitest";
import { applyPatch, PatchError } from "./patch.ts";

// Saída real de `git diff` (com `git add -N` para o teste novo), como a sessão de correção grava.
const DIFF = `diff --git a/src/n.ts b/src/n.ts
index 9ed40b4..4cb29ea 100644
--- a/src/n.ts
+++ b/src/n.ts
@@ -1,2 +1,3 @@
 one
-two
\\ No newline at end of file
+two
+three
diff --git a/src/x.ts b/src/x.ts
index 92dfa21..06b5c2b 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,5 +1,5 @@
 a
-b
+B
 c
 d
 e
@@ -8,3 +8,4 @@ g
 h
 i
 j
+k
diff --git a/tests/x.test.ts b/tests/x.test.ts
new file mode 100644
index 0000000..9daeafb
--- /dev/null
+++ b/tests/x.test.ts
@@ -0,0 +1 @@
+test
`;

const BASE: Record<string, string> = { "src/x.ts": "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n", "src/n.ts": "one\ntwo" };
const read = async (p: string) => BASE[p] ?? null;

describe("aplicar o diff da correção", () => {
  it("altera, acrescenta no fim, corrige o fim sem quebra de linha e cria o teste novo", async () => {
    expect(await applyPatch(DIFF, read)).toEqual([
      { path: "src/n.ts", added: false, content: "one\ntwo\nthree\n" },
      { path: "src/x.ts", added: false, content: "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n" },
      { path: "tests/x.test.ts", added: true, content: "test\n" },
    ]);
  });

  it("contexto diferente da base falha, sem aplicar pela metade", async () => {
    await expect(applyPatch(DIFF, async (p) => (p === "src/x.ts" ? "a\nX\nc\nd\ne\nf\ng\nh\ni\nj\n" : read(p)))).rejects.toThrow(PatchError);
  });

  it("arquivo novo que já existe, ou alterado que não existe, falha", async () => {
    await expect(applyPatch(DIFF, async (p) => (p === "tests/x.test.ts" ? "já\n" : read(p)))).rejects.toThrow(/já existe/);
    await expect(applyPatch(DIFF, async (p) => (p === "src/n.ts" ? null : read(p)))).rejects.toThrow(/não existe/);
  });

  it("recusa remoção, renomeação, mudança de permissão e diff vazio", async () => {
    await expect(applyPatch("diff --git a/a.ts b/a.ts\ndeleted file mode 100644\n--- a/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n", read)).rejects.toThrow(PatchError);
    await expect(applyPatch("diff --git a/a.ts b/b.ts\nrename from a.ts\nrename to b.ts\n", read)).rejects.toThrow(PatchError);
    await expect(applyPatch("diff --git a/a.ts b/a.ts\nold mode 100644\nnew mode 100755\n", read)).rejects.toThrow(PatchError);
    await expect(applyPatch("", read)).rejects.toThrow(/vazio/);
  });

  it("linha retirada no meio e trecho que tira a quebra do fim", async () => {
    const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,2 @@\n x\n-y\n-z\n+z\n\\ No newline at end of file\n";
    expect(await applyPatch(diff, async () => "x\ny\nz\n")).toEqual([{ path: "a.ts", added: false, content: "x\nz" }]);
  });
});
