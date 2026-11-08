import { describe, expect, it } from "vitest";
import { applyFilePatch, checkFixDiff, fixDraftBranchCheck, PatchConflictError, readUnifiedDiff, splitUnifiedDiff } from "./fix.ts";

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

  it("fim de arquivo sem quebra de linha no diff completo: o marcador fica no trecho", () => {
    const patch = ["diff --git a/src/x.ts b/src/x.ts", "--- a/src/x.ts", "+++ b/src/x.ts", "@@ -2 +2 @@", "-b", "\\ No newline at end of file", "+B", "\\ No newline at end of file", ""].join("\n");
    const [f] = splitUnifiedDiff(patch);
    expect(f!.hunks).toEqual(["@@ -2 +2 @@", "-b", "\\ No newline at end of file", "+B", "\\ No newline at end of file"]);
    expect(checkFixDiff(patch, ["src/x.ts"])).toEqual({ ok: true, files: ["src/x.ts"], changedLines: 2 });
  });

  it("fim de arquivo sem quebra de linha", () => {
    const sem = "a\nb";
    expect(applyFilePatch(sem, ["@@ -2 +2 @@", "-b", "\\ No newline at end of file", "+B", "\\ No newline at end of file"])).toBe("a\nB");
    expect(applyFilePatch(sem, ["@@ -2 +2 @@", "-b", "\\ No newline at end of file", "+B"])).toBe("a\nB\n");
    expect(applyFilePatch(sem, ["@@ -1,2 +1,2 @@", "-a", "+A", " b", "\\ No newline at end of file"])).toBe("A\nb");
  });
});

describe("diff malformado: o que se confere é o que se aplica", () => {
  const ok = ["diff --git a/src/ok.ts b/src/ok.ts", "--- a/src/ok.ts", "+++ b/src/ok.ts", "@@ -1 +1 @@", "-a", "+b"];
  const injected = Array.from({ length: 400 }, (_, i) => `+linha injetada ${i}`);
  const reasons = (patch: string) => {
    const r = checkFixDiff(patch, ["src/ok.ts"]);
    return r.ok ? [] : r.reasons;
  };

  it("prova da revisão: cabeçalho 'diff --git X' com 400 linhas antes de um arquivo legítimo é recusado", () => {
    const patch = ["diff --git X", "@@ -0,0 +1,400 @@", ...injected, ...ok, ""].join("\n");
    expect(checkFixDiff(patch, ["src/ok.ts"]).ok).toBe(false);
    expect(reasons(patch)).toEqual(["diff malformado: cabeçalho de arquivo inválido na linha 1"]);
    expect(() => splitUnifiedDiff(patch)).toThrow(PatchConflictError);
    // Sem o cabeçalho falso, o mesmo arquivo passa e só tem a sua linha trocada.
    expect(checkFixDiff(ok.join("\n"), ["src/ok.ts"])).toEqual({ ok: true, files: ["src/ok.ts"], changedLines: 2 });
    expect(splitUnifiedDiff(ok.join("\n"))).toEqual([{ path: "src/ok.ts", status: "modified", hunks: ["@@ -1 +1 @@", "-a", "+b"] }]);
  });

  it("variações: cabeçalho inválido no meio, texto antes do primeiro arquivo, contagem que não bate", () => {
    // Cabeçalho inválido depois de um arquivo legítimo.
    expect(reasons([...ok, "diff --git src/x.ts", "@@ -0,0 +1,2 @@", "+a", "+b"].join("\n"))[0]).toMatch(/^diff malformado: cabeçalho de arquivo inválido na linha 7/);
    // Cabeçalho com caminho só de um lado.
    expect(reasons(["diff --git a/src/ok.ts", ...ok.slice(1)].join("\n"))[0]).toMatch(/cabeçalho de arquivo inválido/);
    // Linhas antes do primeiro cabeçalho válido (só linha vazia é tolerada).
    expect(reasons(["@@ -0,0 +1,1 @@", "+x", ...ok].join("\n"))[0]).toMatch(/texto antes do primeiro arquivo na linha 1/);
    expect(reasons(["Subject: correção", ...ok].join("\n"))[0]).toMatch(/texto antes do primeiro arquivo/);
    expect(checkFixDiff(["", "", ...ok].join("\n"), ["src/ok.ts"]).ok).toBe(true);
    // Trecho que declara 1 linha mas traz 400: as sobras não entram sem contar.
    expect(reasons(["diff --git a/src/ok.ts b/src/ok.ts", "--- a/src/ok.ts", "+++ b/src/ok.ts", "@@ -1 +1 @@", "-a", ...injected].join("\n"))[0]).toMatch(/linha fora de trecho em src\/ok\.ts \(linha 7\)/);
    expect(reasons(["diff --git a/src/ok.ts b/src/ok.ts", "@@ -1,2 +1 @@", "+a", "+b", " c"].join("\n"))[0]).toMatch(/trecho com linhas a mais em src\/ok\.ts \(linha 4\)/);
    // Trecho que declara mais linhas do que traz.
    expect(reasons(["diff --git a/src/ok.ts b/src/ok.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+B"].join("\n"))[0]).toMatch(/trecho incompleto em src\/ok\.ts/);
    // Linha solta depois do trecho e cabeçalho de trecho inválido.
    expect(reasons([...ok, "+escondida"].join("\n"))[0]).toMatch(/linha fora de trecho em src\/ok\.ts/);
    expect(reasons(["diff --git a/src/ok.ts b/src/ok.ts", "@@ -1 +1", "-a", "+b"].join("\n"))[0]).toMatch(/trecho inválido na linha 2/);
    // Na aplicação, o mesmo diff é recusado antes de qualquer escrita.
    expect(() => splitUnifiedDiff([...ok, "+escondida"].join("\n"))).toThrow(/diff malformado/);
  });

  it("caminho e trechos vêm do mesmo cabeçalho, sem entrada de caminho vazio", () => {
    const two = [...ok, "diff --git a/src/ok.test.ts b/src/ok.test.ts", "new file mode 100644", "--- /dev/null", "+++ b/src/ok.test.ts", "@@ -0,0 +1 @@", "+it()"].join("\n");
    const { files, errors } = readUnifiedDiff(two);
    expect(errors).toEqual([]);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions, f.hunks.length])).toEqual([
      ["src/ok.ts", "modified", 1, 1, 3],
      ["src/ok.test.ts", "added", 1, 0, 2],
    ]);
  });
});

describe("branch do rascunho", () => {
  it("só echo/fix-pr-N do próprio PR, nunca a base nem a padrão", () => {
    expect(fixDraftBranchCheck({ branch: "echo/fix-pr-44", base: "ech-128", prNumber: 44 })).toEqual({ ok: true });
    expect(fixDraftBranchCheck({ branch: "ech-128", base: "ech-128", prNumber: 44 })).toMatchObject({ ok: false });
    expect(fixDraftBranchCheck({ branch: "main", base: "ech-128", prNumber: 44, defaultBranch: "main" })).toMatchObject({ ok: false });
    expect(fixDraftBranchCheck({ branch: "echo/fix-pr-44", base: "echo/fix-pr-44", prNumber: 44 })).toMatchObject({ ok: false, reason: "branch echo/fix-pr-44 é a base ou a padrão" });
    expect(fixDraftBranchCheck({ branch: "echo/fix-pr-45", base: "ech-128", prNumber: 44 })).toMatchObject({ ok: false });
    expect(fixDraftBranchCheck({ branch: "echo/fix-pr-44/../main", base: "ech-128", prNumber: 44 })).toMatchObject({ ok: false });
  });
});
