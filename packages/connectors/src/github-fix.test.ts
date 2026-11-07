import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FixRefused, GithubApp } from "./github-client.ts";
import { PatchError } from "./patch.ts";

// Correção (etapa 10) pelo GitHub, com dados sintéticos: o rascunho montado pela API (sem git) e a união.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const NOW = Date.parse("2026-11-07T14:00:00Z");
const REPO = "echo-teste/app";

type Req = { method: string; path: string; body: any };
function fake(routes: Record<string, (r: Req) => Response>) {
  const calls: Req[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const req = { method: init.method ?? "GET", path: u.pathname + u.search, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(req);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === req.method && (p === req.path || (p!.endsWith("*") && req.path.startsWith(p!.slice(0, -1))));
    });
    return key ? routes[key]!(req) : Response.json({ message: "Not Found" }, { status: 404 });
  };
  const gh = new GithubApp({ appId: "1", privateKey, fetch, now: () => NOW, sleep: async () => {} }).forInstallation("9");
  return { gh, calls };
}

const token = { "POST /app/installations/9/access_tokens": () => Response.json({ token: "ghs_t", expires_at: new Date(NOW + 3600_000).toISOString() }) };
const b64 = (s: string) => Buffer.from(s).toString("base64");

const PATCH = `diff --git a/src/pagamentos/tempo-limite.ts b/src/pagamentos/tempo-limite.ts
--- a/src/pagamentos/tempo-limite.ts
+++ b/src/pagamentos/tempo-limite.ts
@@ -1,2 +1,2 @@
 export const LIMITE = 30;
-export const tentar = (n) => n > 3;
+export const tentar = (n) => n >= 3;
`;
const draftInput = { repo: REPO, base: "ech-128-tempo-limite", baseSha: "abc123", branch: "echo/fix-pr-41", title: "Correção do Echo para o PR #41", body: "corpo", patch: PATCH, draft: true };

const baseRoutes = {
  ...token,
  "GET /repos/echo-teste/app/pulls?state=open&head=*": () => Response.json([]),
  "GET /repos/echo-teste/app/git/commits/abc123": () => Response.json({ tree: { sha: "tree0" } }),
  "GET /repos/echo-teste/app/git/trees/tree0?recursive=1": () =>
    Response.json({ truncated: false, tree: [{ path: "src/pagamentos/tempo-limite.ts", mode: "100755", type: "blob", sha: "blob1" }] }),
  "GET /repos/echo-teste/app/git/blobs/blob1": () => Response.json({ encoding: "base64", content: b64("export const LIMITE = 30;\nexport const tentar = (n) => n > 3;\n") }),
  "POST /repos/echo-teste/app/git/trees": () => Response.json({ sha: "tree1" }),
  "POST /repos/echo-teste/app/git/commits": () => Response.json({ sha: "fix1" }),
  "POST /repos/echo-teste/app/pulls": () => Response.json({ number: 48, head: { sha: "fix1" } }),
};

describe("rascunho da correção pelo GitHub", () => {
  it("aplica o diff na versão revisada, mantém o modo do arquivo e abre o PR em rascunho contra a branch do PR", async () => {
    const { gh, calls } = fake({ ...baseRoutes, "POST /repos/echo-teste/app/git/refs": () => Response.json({ ref: "refs/heads/echo/fix-pr-41" }) });
    expect(await gh.openFixDraft(draftInput)).toEqual({ number: 48, headSha: "fix1" });
    const tree = calls.find((c) => c.method === "POST" && c.path.endsWith("/git/trees"))!.body;
    expect(tree).toEqual({ base_tree: "tree0", tree: [{ path: "src/pagamentos/tempo-limite.ts", mode: "100755", type: "blob", content: "export const LIMITE = 30;\nexport const tentar = (n) => n >= 3;\n" }] });
    expect(calls.find((c) => c.path.endsWith("/git/commits") && c.method === "POST")!.body).toEqual({ message: draftInput.title, tree: "tree1", parents: ["abc123"] });
    expect(calls.find((c) => c.path.endsWith("/pulls") && c.method === "POST")!.body).toMatchObject({ head: "echo/fix-pr-41", base: "ech-128-tempo-limite", draft: true });
  });

  it("outra tentativa devolve o rascunho já aberto, sem novo commit", async () => {
    const { gh, calls } = fake({ ...baseRoutes, "GET /repos/echo-teste/app/pulls?state=open&head=*": () => Response.json([{ number: 48, head: { sha: "fix1" } }]) });
    expect(await gh.openFixDraft(draftInput)).toEqual({ number: 48, headSha: "fix1" });
    expect(calls.some((c) => c.method === "POST" && c.path.includes("/git/"))).toBe(false);
  });

  it("branch do Echo que sobrou sem PR é apontada para o commit novo", async () => {
    const { gh, calls } = fake({
      ...baseRoutes,
      "POST /repos/echo-teste/app/git/refs": () => Response.json({ message: "Reference already exists" }, { status: 422 }),
      "PATCH /repos/echo-teste/app/git/refs/heads/echo/fix-pr-41": () => Response.json({}),
    });
    await gh.openFixDraft(draftInput);
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ sha: "fix1", force: true });
  });

  it("diff que não bate com a versão revisada não cria nada", async () => {
    const { gh, calls } = fake({ ...baseRoutes, "GET /repos/echo-teste/app/git/blobs/blob1": () => Response.json({ encoding: "base64", content: b64("outra coisa\n") }) });
    await expect(gh.openFixDraft(draftInput)).rejects.toThrow(PatchError);
    expect(calls.some((c) => c.method === "POST" && c.path.includes("/git/"))).toBe(false);
  });
});

describe("união da correção aprovada", () => {
  const pr = (n: number, state: string, sha: string) => ({ [`GET /repos/echo-teste/app/pulls/${n}`]: () => Response.json({ number: n, state, merged_at: null, head: { sha } }) });
  const input = { repo: REPO, number: 48, sha: "fix1", base: "ech-128-tempo-limite", prNumber: 41 };

  it("une a versão aprovada do rascunho na branch do PR", async () => {
    const { gh, calls } = fake({ ...token, ...pr(48, "open", "fix1"), ...pr(41, "open", "abc123"), "POST /repos/echo-teste/app/merges": () => Response.json({ sha: "merge1" }, { status: 201 }) });
    expect(await gh.mergeFix(input)).toEqual({ sha: "merge1" });
    expect(calls.find((c) => c.path.endsWith("/merges"))!.body).toMatchObject({ base: "ech-128-tempo-limite", head: "fix1" });
  });

  it("recusa se o rascunho mudou, fechou, o PR fechou ou a união conflita", async () => {
    await expect(fake({ ...token, ...pr(48, "open", "outro"), ...pr(41, "open", "abc") }).gh.mergeFix(input)).rejects.toThrow(/mudou/);
    await expect(fake({ ...token, ...pr(48, "closed", "fix1"), ...pr(41, "open", "abc") }).gh.mergeFix(input)).rejects.toThrow(FixRefused);
    await expect(fake({ ...token, ...pr(48, "open", "fix1"), ...pr(41, "closed", "abc") }).gh.mergeFix(input)).rejects.toThrow(/original/);
    const conflict = fake({ ...token, ...pr(48, "open", "fix1"), ...pr(41, "open", "abc"), "POST /repos/echo-teste/app/merges": () => Response.json({ message: "Merge conflict" }, { status: 409 }) });
    await expect(conflict.gh.mergeFix(input)).rejects.toThrow(/conflito/);
  });

  it("já unida antes (204) conta como feita", async () => {
    const { gh } = fake({ ...token, ...pr(48, "open", "fix1"), ...pr(41, "open", "abc"), "POST /repos/echo-teste/app/merges": () => new Response(null, { status: 204 }) });
    expect(await gh.mergeFix(input)).toEqual({ sha: null });
  });
});

describe("leitura para o reviewer", () => {
  it("alvo do PR com fork e branch padrão; token só leitura de um repositório", async () => {
    const { gh, calls } = fake({
      ...token,
      "GET /repos/echo-teste/app/pulls/41": () => Response.json({ number: 41, state: "open", draft: false, merged_at: null, title: "t", user: { login: "f", id: 1 }, head: { sha: "abc", ref: "ech-128", repo: { full_name: "fork/app" } }, base: { repo: { default_branch: "main" } }, created_at: "2026-11-06T10:00:00Z" }),
    });
    expect(await gh.fixTarget(REPO, 41)).toEqual({ state: "open", headSha: "abc", headRepository: "fork/app", repository: REPO, branch: "ech-128", defaultBranch: "main" });
    expect(await gh.fixTarget(REPO, 99)).toBeNull();
    await gh.readOnlyToken(REPO);
    expect(calls.at(-1)!.body).toEqual({ repositories: ["app"], permissions: { contents: "read" } });
  });
});
