import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { GUARDIAN_CODE, MODERATOR_CODE, PRESENTER_SECRET, advance, closeWorld, loginRole, newPage, pickWorld, presenterSelectWorld, requireCodes, STATE_FILE } from "./helpers";

/** Etapa 3: fim do roteiro (crítico, ainda um único caso) e decisão humana com justificativa refletida no responsável. */
test("crítico → decisão humana com justificativa → painel do responsável → encerrar mundo", async ({ browser }) => {
  requireCodes();
  const world = readFileSync(STATE_FILE, "utf8").trim();

  const g = await newPage(browser);
  await loginRole(g.page, "/responsavel", GUARDIAN_CODE, "Ana");
  await pickWorld(g.page, world);
  const m = await newPage(browser);
  await loginRole(m.page, "/moderacao", MODERATOR_CODE, "Marcos");
  const caseItem = m.page.locator(`[data-testid="case-item"][data-world="${world}"]`);
  const p = await newPage(browser);
  await loginRole(p.page, "/apresentador", PRESENTER_SECRET);
  await presenterSelectWorld(p.page, world);

  await advance(p.page, 5);
  await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", "critico", { timeout: 30_000 });
  await m.page.getByLabel("Filtrar por status").selectOption("todos");
  await expect(caseItem).toHaveCount(1, { timeout: 30_000 });
  await expect(caseItem.first()).toContainText("P1");

  await caseItem.first().click();
  await m.page.getByTestId("action-confirm").click();
  await m.page.getByTestId("confirm-action").click();
  await expect(m.page.getByText(/justificativa é obrigatória/i)).toBeVisible();
  await m.page.getByTestId("justification").fill("Padrão coerente: vínculo, dado pessoal, isolamento, código sintético e migração de canal na mesma janela. Hipótese validada para fins de demonstração.");
  await m.page.getByTestId("confirm-action").click();
  await expect(m.page.getByTestId("case-view")).toContainText("Risco confirmado", { timeout: 20_000 });
  await expect(g.page.getByTestId("guardian-case")).toContainText("Risco confirmado", { timeout: 20_000 });
  await expect(p.page.getByText(/Chamadas LLM/)).toBeVisible();

  await closeWorld(p.page);
  await Promise.all([g.context.close(), m.context.close(), p.context.close()]);
});
