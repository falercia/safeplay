import { expect, test } from "@playwright/test";
import { advance, createSession, deleteSession, openRole } from "./helpers";

test("modo degradado: falha forçada da IA não derruba o chat e fica visível", async ({ browser, page }) => {
  const links = await createSession(page, "progressivo");
  const a = await openRole(browser, links.playerA);
  const g = await openRole(browser, links.guardian);

  await page.getByRole("switch", { name: /Forçar erro na chamada/ }).click();
  await expect(page.getByText(/falha forçada/)).toBeVisible({ timeout: 15_000 });

  await advance(page, 7); // linha 7 força análise real → cai no fallback
  await expect(page.getByText(/último fallback/)).toBeVisible({ timeout: 30_000 });
  await expect(g.page.getByTestId("safety-pulse")).toContainText(/modo degradado/, { timeout: 30_000 });
  await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", /atencao|alto/);

  // chat continua funcional
  await expect(a.page.getByRole("log")).toContainText("seus pais deixam", { timeout: 10_000 });
  await a.page.getByLabel("Mensagem").fill("ainda funciona");
  await a.page.getByLabel("Mensagem").press("Enter");
  await expect(a.page.getByRole("log")).toContainText("ainda funciona", { timeout: 5_000 });

  await Promise.all([a.context.close(), g.context.close()]);
  await deleteSession(page);
});
