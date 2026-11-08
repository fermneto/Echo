import { expect, type Page, test } from "@playwright/test";

// Plano diário de ponta a ponta: a liderança distribui, a agenda da pessoa mostra a ordem e só ela muda o dia.
async function entrarComo(page: Page, nome: string) {
  await page.goto("/entrar");
  await page.getByLabel("Usuário").fill(nome);
  await page.getByLabel("Senha").fill("echo");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
}

test("a liderança vê o que falta distribuir e atribui com o dia sugerido", async ({ page }) => {
  await entrarComo(page, "marina");
  await page.goto("/distribuir");
  await expect(page.getByRole("heading", { name: "Distribuir tarefas" })).toBeVisible();
  const linha = page.getByRole("listitem").filter({ hasText: "ECH-163" });
  await expect(linha).toContainText("Depende de ECH-142 de Eduardo");
  const tarefa = page.getByRole("listitem").filter({ hasText: "ECH-164" });
  await expect(tarefa.getByRole("combobox")).not.toHaveValue("");
  await tarefa.getByRole("button", { name: "Atribuir" }).click();
  await expect(tarefa.getByRole("status")).toContainText("Início sugerido");
});

test("quem não é da liderança não tem a mesa de distribuição", async ({ page }) => {
  await entrarComo(page, "fernando");
  const res = await page.goto("/distribuir");
  expect(res?.status()).toBe(404);
});

test("a agenda segue as dependências e a pessoa muda o dia", async ({ page }) => {
  await entrarComo(page, "fernando");
  await page.goto("/plano");
  const agenda = page.getByRole("region", { name: "Agenda dos próximos dias" });
  await expect(agenda).toContainText("ECH-128");
  await expect(agenda.getByText(/Depois da ECH-128/).first()).toBeAttached();
  const mudar = agenda.getByRole("combobox", { name: "Mudar o dia de ECH-145" });
  const dias = await mudar.locator("option").evaluateAll((o) => o.map((x) => (x as unknown as { value: string }).value).filter((v) => /^\d/.test(v)));
  await mudar.selectOption(dias.at(-1)!);
  await expect(agenda.getByRole("combobox", { name: "Mudar o dia de ECH-145" }).locator("option", { hasText: "Voltar à sugestão" })).toBeAttached();
  await agenda.getByRole("combobox", { name: "Mudar o dia de ECH-145" }).selectOption("sugestao");
  await expect(agenda.getByRole("combobox", { name: "Mudar o dia de ECH-145" }).locator("option", { hasText: "Voltar à sugestão" })).toHaveCount(0);
});
