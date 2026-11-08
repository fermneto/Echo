// Trechos de tela do vídeo da semana: quais entregas ganham trecho, quais telas o PR mexe e o que o roteiro pode ter.
import { describe, expect, it } from "vitest";
import type { PullRequest } from "./types.ts";
import { changesScreen, pickVideoDeliveries, previewOrigin, screensFromFiles, scriptIssues, VIDEO_RULES } from "./video.ts";

const pr = (n: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  id: `pr-${n}`, repository: "echo/app", number: n, title: `PR ${n}`, authorId: "fer", state: "merged", branch: `b${n}`,
  files: ["apps/web/app/pagamentos/page.tsx"], reviewerIds: [], headSha: `sha${n}`, mergedAt: new Date(`2026-11-0${n}T12:00:00Z`), ...extra,
});
const dep = (sha: string, extra: Record<string, string> = {}) => ({ sha, environment: "preview", state: "ready", url: `${sha}.vercel.app`, repository: "echo/app", ...extra });
const week = { from: new Date("2026-11-02T00:00:00Z"), to: new Date("2026-11-09T00:00:00Z") };

describe("telas do PR", () => {
  it("rotas do Next.js pelos arquivos; grupos somem; rota com parâmetro fica de fora", () => {
    expect(screensFromFiles(["apps/web/app/(painel)/equipe/page.tsx", "apps/web/app/page.tsx", "apps/web/app/(painel)/pessoas/[id]/page.tsx", "src/pages/conta/index.tsx", "src/pages/api/x.ts", "apps/web/components/Card.tsx"])).toEqual(["/equipe", "/", "/conta"]);
  });
});

describe("entregas que ganham vídeo", () => {
  it("só tela mudada; teste, história e back-end não contam", () => {
    expect(changesScreen(["apps/web/components/Card.tsx"])).toBe(true);
    expect(changesScreen(["packages/domain/src/rules.ts", "apps/web/components/Card.test.tsx", "src/Card.stories.tsx"])).toBe(false);
  });

  it("PR unido da pessoa na semana, com tela e preview pronto do último commit; mais recentes primeiro, até 3", () => {
    const prs = [pr(3), pr(4), pr(5), pr(6), pr(7, { authorId: "edu" }), pr(8, { files: ["api/x.ts"] }), pr(2, { state: "open" }), pr(1, { mergedAt: new Date("2026-10-30T00:00:00Z") })];
    const deps = [dep("sha3"), dep("sha4"), dep("sha5"), dep("sha6"), dep("sha7"), dep("sha8"), dep("sha2"), dep("sha1")];
    const picked = pickVideoDeliveries("fer", prs, deps, week);
    expect(picked.map((c) => c.pr.number)).toEqual([6, 5, 4]);
    expect(picked[0]!.previewUrl).toBe("https://sha6.vercel.app");
    expect(picked).toHaveLength(VIDEO_RULES.maxPerReport);
  });

  it("sem preview pronto, de produção ou de outro repositório: fica só no texto", () => {
    const prs = [pr(3), pr(4), pr(5)];
    const deps = [dep("sha3", { state: "building" }), dep("sha4", { environment: "production" }), dep("sha5", { repository: "outro/app" })];
    expect(pickVideoDeliveries("fer", prs, deps, week)).toEqual([]);
  });

  it("origem do preview só em https", () => {
    expect(previewOrigin("abc.vercel.app/x?y=1")).toBe("https://abc.vercel.app");
    expect(previewOrigin("http://abc.vercel.app")).toBeNull();
    expect(previewOrigin("::")).toBeNull();
  });
});

const PREVIEW = "https://sha6.vercel.app";
const good = {
  title: "Nova tela de pagamentos do PR 41",
  startUrl: `${PREVIEW}/pagamentos`,
  steps: [
    { action: "goto", url: `${PREVIEW}/pagamentos`, caption: "Abre a tela de pagamentos no preview" },
    { action: "click", target: "Novo pagamento", caption: "Cria um pagamento de teste" },
    { action: "fill", target: "Valor", value: "10", caption: "Preenche o valor" },
    { action: "press", key: "Enter", caption: "Envia o formulário" },
    { action: "wait", seconds: 2, caption: "Mostra a resposta da ECH-131" },
  ],
};
const ctx = { previewUrl: PREVIEW, allowedTokens: ["41", "ECH-131"] };

describe("roteiro", () => {
  it("roteiro bom passa", () => {
    expect(scriptIssues(good, ctx)).toEqual([]);
  });

  it("produção, outro domínio ou http são recusados", () => {
    expect(scriptIssues({ ...good, startUrl: "https://app.echo.com.br" }, ctx)).toContain("endereço inicial fora do preview");
    expect(scriptIssues({ ...good, steps: [{ action: "goto", url: "https://evil.example/x", caption: "Abre" }] }, ctx)).toContain("passo 1 sai do preview");
    expect(scriptIssues({ ...good, startUrl: "http://sha6.vercel.app" }, ctx)).toContain("endereço inicial fora do preview");
    expect(scriptIssues({ ...good, startUrl: "http://localhost:3000/" }, ctx)).toEqual([]);
  });

  it("primeira pessoa, número inventado, ação desconhecida e passos demais", () => {
    expect(scriptIssues({ ...good, title: "Eu fiz a tela" }, ctx)).toContain("legenda na primeira pessoa");
    expect(scriptIssues({ ...good, steps: [{ ...good.steps[0], caption: "Responde em 200 ms" }] }, ctx)).toContain("número fora dos identificadores: 200");
    expect(scriptIssues({ ...good, steps: [{ action: "eval", caption: "x" }] }, ctx)).toContain("passo 1 com ação desconhecida");
    expect(scriptIssues({ ...good, steps: Array.from({ length: 13 }, () => good.steps[1]) }, ctx)).toContain("mais de 12 passos");
    expect(scriptIssues(null, ctx)).toEqual(["roteiro sem título", "endereço inicial fora do preview", "roteiro sem passos"]);
  });
});
