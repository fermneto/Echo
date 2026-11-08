import { describe, expect, it } from "vitest";
import { applyFilePatch, PatchConflictError, splitUnifiedDiff } from "./fix.ts";

const ORIGINAL = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n") + "\n";

describe("aplicação do diff da correção", () => {
  it("separa por arquivo, com status e trechos", () => {
    const patch = [
      "diff --git a/src/x.ts b/src/x.ts",
      "index 1..2 100644",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -2,3 +2,3 @@",
      " b",
      "-c",
      "+C",
      " d",
      "diff --git a/src/x.test.ts b/src/x.test.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/x.test.ts",
      "@@ -0,0 +1,2 @@",
      "+linha 1",
      "+linha 2",
      "",
    ].join("\n");
    const files = splitUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.status, f.hunks.length])).toEqual([
      ["src/x.ts", "modified", 5],
      ["src/x.test.ts", "added", 3],
    ]);
    expect(applyFilePatch(ORIGINAL, files[0]!.hunks)).toBe(ORIGINAL.replace("c\n", "C\n"));
    expect(applyFilePatch("", files[1]!.hunks)).toBe("linha 1\nlinha 2\n");
  });

  it("vários trechos, inserção e remoção", () => {
    const hunks = ["@@ -1,2 +1,3 @@", " a", "+a2", " b", "@@ -6,3 +7,2 @@", " f", "-g", " h"];
    expect(applyFilePatch(ORIGINAL, hunks)).toBe("a\na2\nb\nc\nd\ne\nf\nh\n");
  });

  it("contexto que não bate: nada é aplicado", () => {
    expect(() => applyFilePatch(ORIGINAL, ["@@ -2,2 +2,2 @@", " x", "-c", "+C"])).toThrow(PatchConflictError);
    expect(() => applyFilePatch(ORIGINAL, ["@@ -20,1 +20,1 @@", "-z", "+Z"])).toThrow(PatchConflictError);
  });

  it("fim de arquivo sem quebra de linha", () => {
    const sem = "a\nb";
    expect(applyFilePatch(sem, ["@@ -2 +2 @@", "-b", "\\ No newline at end of file", "+B", "\\ No newline at end of file"])).toBe("a\nB");
    expect(applyFilePatch(sem, ["@@ -2 +2 @@", "-b", "\\ No newline at end of file", "+B"])).toBe("a\nB\n");
    expect(applyFilePatch(sem, ["@@ -1,2 +1,2 @@", "-a", "+A", " b", "\\ No newline at end of file"])).toBe("A\nb");
  });
});
