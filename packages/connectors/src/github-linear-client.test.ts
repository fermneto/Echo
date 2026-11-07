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

  it("404 vira null; último commit e PR pela branch", async () => {
    const { gh } = setup();
    expect(await gh.getPullRequest("org-teste/app", 7)).toBeNull();
    expect(await gh.getLastCommitAt("org-teste/app", "ech-128-tempo-limite")).toEqual(new Date("2026-11-07T01:00:00Z"));
    expect(await gh.getLastCommitAt("org-teste/app", "nao-existe")).toBeNull();
    expect((await gh.findPullRequestByBranch("org-teste/app", "ech-128-tempo-limite"))?.number).toBe(42);
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

  it("401 renova o token e tenta de novo; duplicada conta como cancelada", async () => {
    let n = 0;
    const { tracker, tokens } = setup(() => (++n === 1 ? new Response("{}", { status: 401 }) : Response.json({ data: { issue: node({ state: { type: "duplicate", name: "Duplicate" } }) } })));
    expect((await tracker.getTask("ECH-128"))?.state).toBe("canceled");
    expect(tokens()).toBe(2);
  });
});
