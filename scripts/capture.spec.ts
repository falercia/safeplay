import { test } from "@playwright/test";
import { advance, createSession, deleteSession, openRole } from "../e2e/helpers";

/** Gera capturas para o Plano B (docs/capturas) executando o cenário progressivo de verdade. */
test("capturas do cenário progressivo", async ({ browser, page }) => {
  const out = "docs/capturas";
  const links = await createSession(page, "progressivo");
  const a = await openRole(browser, links.playerA);
  const b = await openRole(browser, links.playerB);
  const g = await openRole(browser, links.guardian);
  const m = await openRole(browser, links.moderator);
  await g.page.setViewportSize({ width: 1440, height: 1000 });
  await m.page.setViewportSize({ width: 1440, height: 1000 });
  await a.page.setViewportSize({ width: 430, height: 900 });
  await b.page.setViewportSize({ width: 430, height: 900 });
  await a.page.getByRole("log").waitFor();
  await b.page.getByLabel("Mensagem").fill("oi Nico");
  await b.page.getByLabel("Mensagem").press("Enter");
  await a.page.getByLabel("Mensagem").fill("oi!! bora jogar?");
  await a.page.getByLabel("Mensagem").press("Enter");
  await advance(page, 7);
  await g.page.waitForTimeout(2500);
  await g.page.screenshot({ path: `${out}/02-responsavel-atencao.png`, fullPage: true });
  await advance(page, 6);
  await g.page.waitForTimeout(2500);
  await a.page.screenshot({ path: `${out}/01-chat-mobile.png`, fullPage: true });
  await g.page.screenshot({ path: `${out}/03-responsavel-critico.png`, fullPage: true });
  await m.page.waitForTimeout(1500);
  await m.page.screenshot({ path: `${out}/04-moderacao-caso.png`, fullPage: true });
  await g.page.getByTestId("explain-button").click();
  await g.page.waitForTimeout(800);
  await g.page.screenshot({ path: `${out}/05-transparencia.png`, fullPage: true });
  await page.screenshot({ path: `${out}/06-central-demo.png`, fullPage: true });
  await Promise.all([a.context.close(), b.context.close(), g.context.close(), m.context.close()]);
  await deleteSession(page);
});
