import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createWorld, enterGame, joinWorld, newPage, requireCodes, STATE_FILE } from "./helpers";

/** Etapa 1: dois jogadores reais criam/entram no mundo e trocam mensagens em tempo real. */
test("início → entrar → lobby → mundo → chat ao vivo entre dois navegadores", async ({ browser }) => {
  requireCodes();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();

  const a = await newPage(browser);
  await enterGame(a.page, `Nico ${stamp}`);
  const world = await createWorld(a.page, `Teste ${stamp}`);
  expect(world).toMatch(/^W-/);
  await expect(a.page.getByRole("log")).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByText("aguardando outro jogador")).toBeVisible();

  const b = await newPage(browser);
  await enterGame(b.page, `Dex ${stamp}`);
  await joinWorld(b.page, world);
  await expect(b.page.getByRole("log")).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByText("aguardando outro jogador")).toHaveCount(0, { timeout: 20_000 });
  await expect(a.page.getByTitle("Participantes online")).toContainText(/2 online/, { timeout: 20_000 });

  await b.page.getByLabel("Mensagem").fill("oi Nico");
  await expect(a.page.getByText(/digitando/)).toBeVisible({ timeout: 10_000 });
  const t0 = Date.now();
  await b.page.getByLabel("Mensagem").press("Enter");
  await expect(a.page.getByRole("log")).toContainText("oi Nico", { timeout: 10_000 });
  console.log(`entrega B→A (fria): ${Date.now() - t0} ms`);
  await expect(a.page.getByRole("log").getByText("oi Nico", { exact: true })).toHaveCount(1);
  await a.page.getByLabel("Mensagem").fill("oi!! bora jogar?");
  const t1 = Date.now();
  await a.page.getByLabel("Mensagem").press("Enter");
  await expect(b.page.getByRole("log")).toContainText("bora jogar?", { timeout: 5_000 });
  console.log(`entrega A→B (quente): ${Date.now() - t1} ms`);

  await a.page.screenshot({ path: "docs/capturas/01-mundo-jogo-chat.png" });
  writeFileSync(STATE_FILE, world);
  await Promise.all([a.context.close(), b.context.close()]);
});

test("código de acesso errado é bloqueado no servidor", async ({ page }) => {
  requireCodes();
  await page.goto("/");
  await page.screenshot({ path: "docs/capturas/00-inicio.png" });
  await enterGame(page, "Intruso", "ERRADO-123");
  await expect(page.getByText(/código de acesso inválido/i)).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/entrar/);
});
