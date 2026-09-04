import { expect, test } from "@playwright/test";
import { advance, createSession, deleteSession, openRole } from "./helpers";

test("cenário saudável: sem alerta indevido e sem caso", async ({ browser, page }) => {
  const links = await createSession(page, "saudavel");
  const g = await openRole(browser, links.guardian);
  const m = await openRole(browser, links.moderator);
  await advance(page, 12);
  await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", "baixo");
  await expect(g.page.getByText("Nenhum alerta.")).toBeVisible();
  await m.page.getByLabel("Filtrar por status").selectOption("todos");
  await expect(m.page.getByTestId("case-item")).toHaveCount(0);
  await Promise.all([g.context.close(), m.context.close()]);
  await deleteSession(page);
});

test("falso positivo: atenção, caso P3, descarte humano com justificativa e sem reabertura", async ({ browser, page }) => {
  const links = await createSession(page, "falso_positivo");
  const g = await openRole(browser, links.guardian);
  const m = await openRole(browser, links.moderator);
  await advance(page, 5);
  await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", "atencao", { timeout: 30_000 });
  await expect(m.page.getByTestId("case-item")).toHaveCount(1, { timeout: 30_000 });
  await expect(m.page.getByTestId("case-item").first()).toContainText("P3");

  await m.page.getByTestId("action-dismiss").click();
  await m.page.getByTestId("justification").fill("Contexto de jogo: 'segredo' refere-se a um atalho do mapa e 'quantos anos' a tempo de experiência. Sem intenção de aproximação.");
  await m.page.getByTestId("confirm-action").click();
  await expect(m.page.getByTestId("case-view")).toContainText("Falso positivo descartado", { timeout: 20_000 });
  await expect(g.page.getByTestId("guardian-case")).toContainText("Falso positivo descartado", { timeout: 20_000 });

  // mensagens seguintes não reabrem caso no mesmo nível
  await advance(page, 2);
  await m.page.getByLabel("Filtrar por status").selectOption("todos");
  await expect(m.page.getByTestId("case-item")).toHaveCount(1);
  await Promise.all([g.context.close(), m.context.close()]);
  await deleteSession(page);
});
