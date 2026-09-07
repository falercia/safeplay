import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { GUARDIAN_CODE, MODERATOR_CODE, PRESENTER_SECRET, advance, loginRole, newPage, pickWorld, presenterSelectWorld, requireCodes, STATE_FILE } from "./helpers";

/** Etapa 2: responsável e moderação acompanham; apresentador roda o roteiro progressivo até Alto + caso. */
test("roteiro progressivo → alerta no responsável → caso único na moderação", async ({ browser }) => {
  requireCodes();
  const world = readFileSync(STATE_FILE, "utf8").trim();

  const g = await newPage(browser);
  await loginRole(g.page, "/responsavel", GUARDIAN_CODE, "Ana");
  await pickWorld(g.page, world);
  await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", "baixo", { timeout: 30_000 });

  const m = await newPage(browser);
  await loginRole(m.page, "/moderacao", MODERATOR_CODE, "Marcos");
  const caseItem = m.page.locator(`[data-testid="case-item"][data-world="${world}"]`);

  const p = await newPage(browser);
  await loginRole(p.page, "/apresentador", PRESENTER_SECRET);
  await presenterSelectWorld(p.page, world);
  await p.page.getByTestId("scenario-progressivo").click();
  await expect(p.page.getByTestId("advance")).toHaveText(/\(1\//, { timeout: 30_000 });
  await advance(p.page, 9);
  await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", /alto|critico/, { timeout: 30_000 });
  await expect(caseItem).toHaveCount(1, { timeout: 30_000 });
  await g.page.screenshot({ path: "docs/capturas/02-responsavel-alto.png", fullPage: true });
  await expect(p.page.getByText("Status dos serviços")).toBeVisible();
  await p.page.screenshot({ path: "docs/capturas/03-apresentador.png", fullPage: true });
  await expect(p.page.getByText(/pronta · claude|modo regras|plano B/)).toBeVisible();

  await Promise.all([g.context.close(), m.context.close(), p.context.close()]);
});
