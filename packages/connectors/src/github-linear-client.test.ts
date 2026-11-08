import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appJwt, GithubApiError, GithubApp, normalizePem, selectDeliveriesToRetry } from "./github-client.ts";
import { LinearApiError, LinearTracker } from "./linear-client.ts";
import { RefreshingToken } from "./tokens.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const NOW = Date.parse("2026-11-07T14:00:00Z");

type Route = (req: { method: string; path: string; body: any; auth: string | null }) => Response | Promise<Response>;
function fakeFetch(routes: Record<string, Route>) {
  const calls: { method: string; path: string; auth: string | null }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("authorization");
    calls.push({ method, path, auth });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && (p === path || (p!.endsWith("*") && path.startsWith(p!.slice(0, -1))));
    });
    if (!key) return Response.json({ message: "Not Found" }, { status: 404 });
    return routes[key]!({ method, path, body: init.body ? (String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : String(init.body)) : null, auth });
  };
  return { calls, fetch };
}

describe("RefreshingToken", () => {
  it("busca uma vez para pedidos simultâneos e renova perto de vencer", async () => {
    let t = NOW;
    let n = 0;
    const tok = new RefreshingToken(async () => ({ token: `t${++n}`, expiresAt: t + 60 * 60_000 }), 5 * 60_000, () => t);
    expect(await Promise.all([tok.get(), tok.get(), tok.get()])).toEqual(["t1", "t1", "t1"]);
    t += 54 * 60_000;
    expect(await tok.get()).toBe("t1");
    t += 2 * 60_000; // dentro da folga de 5 minutos
    expect(await tok.get()).toBe("t2");
    expect(n).toBe(2);
  });
});

describe("GitHub App", () => {
  it("JWT RS256 assinado com a chave do app, com iss e validade de 9 minutos", () => {
    const jwt = appJwt("12345", privateKey, NOW / 1000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toEqual({ iat: NOW / 1000 - 60, exp: NOW / 1000 + 540, iss: "12345" });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
    expect(normalizePem(privateKey.replace(/\n/g, "\\n"))).toBe(privateKey.trim());
  });

  const prJson = { number: 42, title: "ECH-128: tempo limite", state: "open", draft: false, merged_at: null, mergeable: null, created_at: "2026-11-06T20:00:00Z", updated_at: "2026-11-06T21:00:00Z", head: { ref: "ech-128-tempo-limite", sha: "abc" }, user: { login: "fernando-dev", id: 101 }, requested_reviewers: [] };

  function setup() {
    let tokens = 0;
    const f = fakeFetch({
      "POST /app/installations/555/access_tokens": () => Response.json({ token: `ghs_${++tokens}`, expires_at: new Date(NOW + 3600_000).toISOString() }),
      "GET /repos/org-teste/app/pulls/42": () => Response.json(prJson),
      "GET /repos/org-teste/app/pulls/42/files*": ({ path }) => Response.json(/[?&]page=1$/.test(path) ? Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.ts` })) : [{ filename: "src/pagamentos/cliente.ts" }]),
      "GET /repos/org-teste/app/commits/ech-128-tempo-limite": () => Response.json({ commit: { committer: { date: "2026-11-07T01:00:00Z" } } }),
      "GET /repos/org-teste/app/pulls?state=all*": () => Response.json([prJson]),
    });
    const app = new GithubApp({ appId: "12345", privateKey, fetch: f.fetch, now: () => NOW, sleep: async () => {} });
    return { ...f, gh: app.forInstallation("555"), app, tokens: () => tokens };
  }

  it("PR ao vivo com arquivos paginados e mergeable nulo (ainda em cálculo)", async () => {
    const { gh, calls, tokens } = setup();
    const pr = await gh.getPullRequest("org-teste/app", 42);
    expect(pr).toMatchObject({ number: 42, state: "open", taskKey: "ECH-128", mergeable: null, author: { login: "fernando-dev" } });
    expect(pr!.files).toHaveLength(101);
    expect(tokens()).toBe(1); // um token para as três chamadas
    expect(calls[0]!.auth).toMatch(/^Bearer ey/); // JWT do app só para pegar o token
    expect(calls.at(-1)!.auth).toBe("Bearer ghs_1");
  });

  it("diff do PR para a revisão noturna: head, arquivos paginados, renomeado e arquivo sem patch", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.ts`, additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" }));
    const f = fakeFetch({
      "POST /app/installations/9/access_tokens": () => Response.json({ token: "t", expires_at: new Date(NOW + 3600_000).toISOString() }),
      "GET /repos/a/b/pulls/5": () => Response.json({ head: { sha: "abc123" } }),
      "GET /repos/a/b/pulls/5/files*": ({ path }) =>
        Response.json(/[?&]page=1$/.test(path) ? page1 : [{ filename: "src/novo.ts", previous_filename: "src/velho.ts", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-a\n+b\n+c" }, { filename: "logo.png", additions: 0, deletions: 0 }]),
    });
    const gh = new GithubApp({ appId: "1", privateKey, fetch: f.fetch, now: () => NOW }).forInstallation("9");
    const diff = await gh.getPullRequestDiff("a/b", 5);
    expect(diff!.headSha).toBe("abc123");
    expect(diff!.files).toHaveLength(102);
    expect(diff!.files[100]).toEqual({ path: "src/novo.ts", additions: 2, deletions: 1 });
    expect(diff!.patch).toContain("diff --git a/src/velho.ts b/src/novo.ts\n--- a/src/velho.ts\n+++ b/src/novo.ts\n@@ -1 +1,2 @@\n-a\n+b\n+c\n");
    expect(diff!.patch).toContain("+++ b/logo.png\n(diff não disponível");
    expect(diff!.totalChars).toBe(diff!.patch.length);
    expect(await gh.getPullRequestDiff("a/b", 6)).toBeNull();
  });

  it("correção: alvo, token só leitura do repositório, rascunho com o diff aplicado e união da versão aprovada", async () => {
    const bodies: Record<string, any> = {};
    const f = fakeFetch({
      "POST /app/installations/9/access_tokens": ({ body }) => ((bodies.token = body), Response.json({ token: body ? "ghs_leitura" : "t", expires_at: new Date(NOW + 3600_000).toISOString() })),
      "GET /repos/a/b/pulls/5": () => Response.json({ state: "open", draft: false, head: { sha: "base1", ref: "feat-x", repo: { full_name: "a/b" } }, base: { repo: { full_name: "a/b", default_branch: "main" } } }),
      "GET /repos/a/b/contents/src/x.ts?ref=base1": () => Response.json({ sha: "blob1", encoding: "base64", content: Buffer.from("a\nb\nc\n").toString("base64") }),
      "GET /repos/a/b/git/commits/base1": () => Response.json({ tree: { sha: "tree1" } }),
      "POST /repos/a/b/git/trees": ({ body }) => ((bodies.tree = body), Response.json({ sha: "tree2" })),
      "POST /repos/a/b/git/commits": ({ body }) => ((bodies.commit = body), Response.json({ sha: "fix1" })),
      "POST /repos/a/b/git/refs": () => Response.json({ message: "Reference already exists" }, { status: 422 }),
      "PATCH /repos/a/b/git/refs/heads/echo/fix-pr-5": ({ body }) => ((bodies.ref = body), Response.json({})),
      "POST /repos/a/b/pulls": ({ body }) => ((bodies.pr = body), Response.json({ number: 6 })),
      "POST /repos/a/b/merges": ({ body }) => ((bodies.merge = body), Response.json({ sha: "m1" }, { status: 201 })),
    });
    const gh = new GithubApp({ appId: "1", privateKey, fetch: f.fetch, now: () => NOW }).forInstallation("9");
    expect(await gh.target("a/b", 5)).toEqual({ state: "open", headSha: "base1", headRepository: "a/b", repository: "a/b", branch: "feat-x", defaultBranch: "main" });
    expect(await gh.pull("a/b", 5)).toEqual({ state: "open", headSha: "base1" });
    expect(await gh.readToken("a/b")).toBe("ghs_leitura");
    expect(bodies.token).toEqual({ repositories: ["b"], permissions: { contents: "read" } });

    const patch = ["diff --git a/src/x.ts b/src/x.ts", "--- a/src/x.ts", "+++ b/src/x.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c", ""].join("\n");
    expect(await gh.createFixDraft({ repo: "a/b", base: "feat-x", baseSha: "base1", branch: "echo/fix-pr-5", title: "Correção", body: "corpo", patch })).toEqual({ number: 6, headSha: "fix1" });
    expect(bodies.tree).toEqual({ base_tree: "tree1", tree: [{ path: "src/x.ts", mode: "100644", type: "blob", content: "a\nB\nc\n" }] });
    expect(bodies.commit).toMatchObject({ tree: "tree2", parents: ["base1"] });
    expect(bodies.ref).toEqual({ sha: "fix1", force: true }); // branch do Echo que já existia
    expect(bodies.pr).toMatchObject({ head: "echo/fix-pr-5", base: "feat-x", draft: true });
    await expect(gh.createFixDraft({ repo: "a/b", base: "feat-x", baseSha: "base1", branch: "echo/fix-pr-5", title: "t", body: "b", patch: patch.replace(" a\n", " z\n") })).rejects.toThrow(/contexto não bate/);
    // Branch que não é do Echo nem chega a ler o código; diff malformado é recusado antes de escrever.
    delete bodies.tree;
    await expect(gh.createFixDraft({ repo: "a/b", base: "feat-x", baseSha: "base1", branch: "feat-x", title: "t", body: "b", patch })).rejects.toThrow(/não é do Echo/);
    await expect(gh.createFixDraft({ repo: "a/b", base: "feat-x", baseSha: "base1", branch: "echo/fix-pr-5", title: "t", body: "b", patch: ["diff --git X", "@@ -0,0 +1 @@", "+x", patch].join("\n") })).rejects.toThrow(/diff malformado/);
    expect(bodies.tree).toBeUndefined();

    expect(await gh.mergeFix({ repo: "a/b", base: "feat-x", sha: "fix1", message: "m" })).toEqual({ sha: "m1" });
    expect(bodies.merge).toEqual({ base: "feat-x", head: "fix1", commit_message: "m" });
  });

  it("404 vira null; último commit e PR pela branch", async () => {
    const { gh } = setup();
    expect(await gh.getPullRequest("org-teste/app", 7)).toBeNull();
    expect(await gh.getLastCommitAt("org-teste/app", "ech-128-tempo-limite")).toEqual(new Date("2026-11-07T01:00:00Z"));
    expect(await gh.getLastCommitAt("org-teste/app", "nao-existe")).toBeNull();
    expect((await gh.findPullRequestByBranch("org-teste/app", "ech-128-tempo-limite"))?.number).toBe(42);
  });

  it("checks: check runs paginados e commit statuses antigos; qualquer falha de um dos dois é falha", async () => {
    const run = (name: string, conclusion: string | null, status = "completed") => ({ name, status, conclusion });
    const page = (n: number, total: number, last: ReturnType<typeof run>[]) => ({ total_count: total, check_runs: n === 1 ? Array.from({ length: 100 }, (_, i) => run(`c${i}`, "success")) : last });
    const pageOf = (path: string) => Number(/[?&]page=(\d+)/.exec(path)![1]);
    const status = (context: string, state: string) => ({ context, state });
    const host = (runs: (p: number) => unknown, statuses: unknown[]) => {
      const f = fakeFetch({
        "POST /app/installations/9/access_tokens": () => Response.json({ token: "t", expires_at: new Date(NOW + 3600_000).toISOString() }),
        "GET /repos/a/b/commits/sha1/check-runs*": ({ path }) => Response.json(runs(pageOf(path))),
        "GET /repos/a/b/commits/sha1/status*": () => Response.json({ state: "x", total_count: statuses.length, statuses }),
      });
      return { ...f, gh: new GithubApp({ appId: "1", privateKey, fetch: f.fetch, now: () => NOW }).forInstallation("9") };
    };

    // Tudo verde nas duas fontes, com a segunda página dos check runs lida.
    const ok = host((p) => page(p, 101, [run("lint", "success")]), [status("ci/legado", "success")]);
    expect(await ok.gh.getChecks("a/b", "sha1")).toMatchObject({ state: "success", total: 102, failed: [], running: 0 });
    expect(ok.calls.filter((c) => c.path.includes("/check-runs")).map((c) => pageOf(c.path))).toEqual([1, 2]);

    // A falha está só na segunda página: antes, com 100 por vez, ficava verde.
    expect(await host((p) => page(p, 101, [run("e2e", "failure")]), []).gh.getChecks("a/b", "sha1")).toMatchObject({ state: "failure", failed: ["e2e"] });
    // Commit status antigo com failure ou error vira falha, mesmo com todos os check runs verdes.
    expect(await host(() => ({ total_count: 1, check_runs: [run("lint", "success")] }), [status("jenkins", "error")]).gh.getChecks("a/b", "sha1")).toMatchObject({ state: "failure", failed: ["jenkins"] });
    expect(await host(() => ({ total_count: 0, check_runs: [] }), [status("ci/a", "success"), status("ci/b", "failure")]).gh.getChecks("a/b", "sha1")).toMatchObject({ state: "failure", failed: ["ci/b"] });
    // Rodando em qualquer um dos dois: ainda não é verde.
    expect(await host(() => ({ total_count: 1, check_runs: [run("lint", "success")] }), [status("ci/legado", "pending")]).gh.getChecks("a/b", "sha1")).toMatchObject({ state: "pending", running: 1 });
    expect(await host(() => ({ total_count: 1, check_runs: [run("lint", null, "in_progress")] }), [status("ci/legado", "success")]).gh.getChecks("a/b", "sha1")).toMatchObject({ state: "pending", running: 1 });
    // Só statuses antigos verdes: verde; nada em nenhum dos dois: none; só neutros: neutral.
    expect((await host(() => ({ total_count: 0, check_runs: [] }), [status("ci/legado", "success")]).gh.getChecks("a/b", "sha1")).state).toBe("success");
    expect((await host(() => ({ total_count: 0, check_runs: [] }), []).gh.getChecks("a/b", "sha1")).state).toBe("none");
    expect((await host(() => ({ total_count: 1, check_runs: [run("opcional", "skipped")] }), []).gh.getChecks("a/b", "sha1")).state).toBe("neutral");

    // Mais de 10 páginas: lê só 10 e o resto conta como rodando, nunca verde.
    const many = host(() => ({ total_count: 1500, check_runs: Array.from({ length: 100 }, (_, i) => run(`c${i}`, "success")) }), []);
    expect(await many.gh.getChecks("a/b", "sha1")).toMatchObject({ state: "pending", running: 500 });
    expect(many.calls.filter((c) => c.path.includes("/check-runs"))).toHaveLength(10);

    // Sem leitura dos statuses (ex.: 403): o erro sobe, quem chama trata como "não sei".
    const f = fakeFetch({
      "POST /app/installations/9/access_tokens": () => Response.json({ token: "t", expires_at: new Date(NOW + 3600_000).toISOString() }),
      "GET /repos/a/b/commits/sha1/check-runs*": () => Response.json({ total_count: 1, check_runs: [run("lint", "success")] }),
      "GET /repos/a/b/commits/sha1/status*": () => Response.json({ message: "Resource not accessible by integration" }, { status: 403 }),
    });
    await expect(new GithubApp({ appId: "1", privateKey, fetch: f.fetch, now: () => NOW }).forInstallation("9").getChecks("a/b", "sha1")).rejects.toBeInstanceOf(GithubApiError);
  });

  it("limite de taxa: espera curta uma vez; espera longa falha com erro claro", async () => {
    let n = 0;
    const short = fakeFetch({
      "POST /app/installations/1/access_tokens": () => Response.json({ token: "t", expires_at: new Date(NOW + 3600_000).toISOString() }),
      "GET /repos/a/b/pulls?state=open*": () => (++n === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "2" } }) : Response.json([])),
    });
    expect(await new GithubApp({ appId: "1", privateKey, fetch: short.fetch, sleep: async () => {} }).forInstallation("1").listOpenPullRequests("a/b")).toEqual([]);
    const long = fakeFetch({
      "POST /app/installations/1/access_tokens": () => Response.json({ token: "t", expires_at: new Date(NOW + 3600_000).toISOString() }),
      "GET /repos/a/b/pulls?state=open*": () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(NOW / 1000 + 600) } }),
    });
    await expect(new GithubApp({ appId: "1", privateKey, fetch: long.fetch, now: () => NOW }).forInstallation("1").listOpenPullRequests("a/b")).rejects.toThrow(GithubApiError);
  });

  it("reenvia só entregas que nunca deram certo, uma vez cada", async () => {
    const deliveries = [
      { id: "1", guid: "g1", status_code: 500 },
      { id: "2", guid: "g1", status_code: 200 },
      { id: "3", guid: "g2", status_code: 502 },
      { id: "4", guid: "g2", status_code: 504 },
    ];
    expect(selectDeliveriesToRetry(deliveries).map((d) => d.id)).toEqual(["3"]);
    const posted: string[] = [];
    const f = fakeFetch({
      "GET /app/hook/deliveries?per_page=100": () => Response.json(deliveries),
      "POST /app/hook/deliveries/*": ({ path }) => (posted.push(path), new Response(null, { status: 202 })),
    });
    expect(await new GithubApp({ appId: "1", privateKey, fetch: f.fetch }).redeliverFailedWebhooks()).toBe(1);
    expect(posted).toEqual(["/app/hook/deliveries/3/attempts"]);
  });
});

describe("Linear", () => {
  const node = (over: Record<string, unknown> = {}) => ({ id: "lin-uuid-128", identifier: "ECH-128", title: "Tempo limite", dueDate: "2026-11-13", estimate: 3, updatedAt: "2026-11-07T08:00:00Z", completedAt: null, assignee: { id: "lin-user-fer" }, state: { type: "started", name: "In Review" }, labels: { nodes: [{ name: "pagamentos" }] }, ...over });

  function setup(graphql: Route) {
    let tokens = 0;
    const f = fakeFetch({
      "POST /oauth/token": ({ auth, body }) => {
        expect(auth).toBe(`Basic ${Buffer.from("cid:csec").toString("base64")}`);
        expect(String(body)).toContain("grant_type=client_credentials");
        return Response.json({ access_token: `lin_${++tokens}`, expires_in: 86_400 });
      },
      "POST /graphql": graphql,
    });
    return { ...f, tracker: new LinearTracker({ clientId: "cid", clientSecret: "csec", fetch: f.fetch, now: () => NOW }), tokens: () => tokens };
  }

  it("tarefa ao vivo com estado, tamanho, prazo e responsável externo", async () => {
    const { tracker } = setup(() => Response.json({ data: { issue: node() } }));
    expect(await tracker.getTask("ECH-128")).toMatchObject({ key: "ECH-128", state: "in_review", size: 3, dueDate: "2026-11-13", labels: ["pagamentos"], assignee: { externalId: "lin-user-fer" } });
  });

  it("tarefa inexistente vira null; outro erro vira LinearApiError", async () => {
    expect(await setup(() => Response.json({ errors: [{ message: "Entity not found", extensions: { code: "INPUT_ERROR" } }] })).tracker.getTask("ECH-999")).toBeNull();
    await expect(setup(() => Response.json({ errors: [{ message: "Rate limited", extensions: { code: "RATELIMITED" } }] }, { status: 400 })).tracker.getTask("ECH-1")).rejects.toThrow(LinearApiError);
  });

  it("lista paginada até 10 páginas e avisa quando cortou", async () => {
    const { tracker, tokens } = setup(({ body }) =>
      Response.json({ data: { issues: { nodes: [node({ identifier: `ECH-${body.variables.after ?? 0}` })], pageInfo: { hasNextPage: true, endCursor: String(Number(body.variables.after ?? 0) + 1) } } } }),
    );
    const res = await tracker.listOpenTasks();
    expect(res.tasks).toHaveLength(10);
    expect(res.truncated).toBe(true);
    expect(tokens()).toBe(1);
  });

  it("chave pessoal vai sem Bearer", async () => {
    let auth = "";
    const tracker = new LinearTracker({ token: "lin_api_abc", fetch: async (_u, i) => ((auth = new Headers(i.headers).get("authorization")!), Response.json({ data: { issue: null } })) });
    expect(await tracker.getTask("ECH-1")).toBeNull();
    expect(auth).toBe("lin_api_abc");
  });

  it("401 renova o token e tenta de novo; duplicada conta como cancelada", async () => {
    let n = 0;
    const { tracker, tokens } = setup(() => (++n === 1 ? new Response("{}", { status: 401 }) : Response.json({ data: { issue: node({ state: { type: "duplicate", name: "Duplicate" } }) } })));
    expect((await tracker.getTask("ECH-128"))?.state).toBe("canceled");
    expect(tokens()).toBe(2);
  });
});
