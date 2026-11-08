import { expect, type Page, test } from "@playwright/test";

// O que a pessoa encontra quando algo sai do caminho: endereço errado, teclado e link compartilhado.
async function entrarComo(page: Page, nome: string) {
  await page.goto("/entrar");
  await page.getByLabel("Usuário").fill(nome);
  await page.getByLabel("Senha").fill("echo");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
}

test("endereço errado mostra a página própria, com status 404 e caminho de volta", async ({ page }) => {
  const res = await page.goto("/rota-que-nao-existe");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Esta página não existe." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir para o início" })).toHaveAttribute("href", "/");
});

test("tela sem permissão continua 404 e mantém o menu do painel", async ({ page }) => {
  await entrarComo(page, "fernando");
  const res = await page.goto("/distribuir");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Esta página não existe." })).toBeVisible();
  await expect(page.getByRole("button", { name: "SAIR" })).toBeVisible();
});

test("a primeira tecla Tab oferece pular para o conteúdo", async ({ page }) => {
  await entrarComo(page, "fernando");
  await page.goto("/equipe");
  await page.keyboard.press("Tab");
  const atalho = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(atalho).toBeFocused();
  await expect(atalho).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#conteudo$/);
});

test("a landing tem prévia de compartilhamento e só ela é aberta aos buscadores", async ({ page, request }) => {
  await page.goto("/landing");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /A resposta não precisa esperar/);
  const imagem = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(imagem).toMatch(/^https?:\/\/.+\/landing\/imagem-social$/);
  const png = await request.get("/landing/imagem-social");
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toContain("image/png");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /landing");
  expect(robots).toContain("Disallow: /");
});
