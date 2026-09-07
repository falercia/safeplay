import { expect, test } from "@playwright/test";
import { GAME_ACCESS_CODE, GUARDIAN_CODE, MODERATOR_CODE, PRESENTER_SECRET, advance, closeWorld, createWorld, enterGame, joinWorld, loginRole, newPage, pickWorld, presenterSelectWorld, requireCodes } from "./helpers";

test.describe("v2 · dois jogadores reais, mundo, roteiro progressivo, responsável, moderação", () => {
  test("início → entrar → lobby → mundo → chat ao vivo → roteiro → alerta → caso → decisão humana", async ({ browser }) => {
    requireCodes();
    const stamp = Date.now().toString(36).slice(-4).toUpperCase();

    // jogador A cria o mundo
    const a = await newPage(browser);
    await enterGame(a.page, `Nico ${stamp}`);
    const world = await createWorld(a.page, `Teste ${stamp}`);
    expect(world).toMatch(/^W-/);
    await expect(a.page.getByRole("log")).toBeVisible({ timeout: 30_000 });
    await expect(a.page.getByText("aguardando outro jogador")).toBeVisible();

    // jogador B entra pelo lobby (lista em tempo real)
    const b = await newPage(browser);
    await enterGame(b.page, `Dex ${stamp}`);
    await joinWorld(b.page, world);
    await expect(b.page.getByRole("log")).toBeVisible({ timeout: 30_000 });
    await expect(a.page.getByText("aguardando outro jogador")).toHaveCount(0, { timeout: 20_000 });
    await expect(a.page.getByTitle("Participantes online")).toContainText(/2 online/, { timeout: 20_000 });

    // digitação e entrega em tempo real
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

    // responsável escolhe o mundo; moderador abre a fila
    const g = await newPage(browser);
    await loginRole(g.page, "/responsavel", GUARDIAN_CODE, "Ana");
    await pickWorld(g.page, world);
    await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", "baixo", { timeout: 30_000 });
    const m = await newPage(browser);
    await loginRole(m.page, "/moderacao", MODERATOR_CODE, "Marcos");
    const caseItem = m.page.locator(`[data-testid="case-item"][data-world="${world}"]`);

    // apresentador opera o roteiro dentro do mundo
    const p = await newPage(browser);
    await loginRole(p.page, "/apresentador", PRESENTER_SECRET);
    await presenterSelectWorld(p.page, world);
    await p.page.getByTestId("scenario-progressivo").click();
    await expect(p.page.getByTestId("advance")).toHaveText(/\(1\//, { timeout: 30_000 });
    await advance(p.page, 9);
    await expect(a.page.getByRole("log")).toContainText("roteiro", { timeout: 20_000 });
    await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", /alto|critico/, { timeout: 30_000 });
    await expect(caseItem).toHaveCount(1, { timeout: 30_000 });

    await advance(p.page, 5);
    await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", "critico", { timeout: 30_000 });
    await m.page.getByLabel("Filtrar por status").selectOption("todos");
    await expect(caseItem).toHaveCount(1);
    await expect(caseItem.first()).toContainText("P1");

    // decisão humana com justificativa obrigatória
    await caseItem.first().click();
    await m.page.getByTestId("action-confirm").click();
    await m.page.getByTestId("confirm-action").click();
    await expect(m.page.getByText(/justificativa é obrigatória/i)).toBeVisible();
    await m.page.getByTestId("justification").fill("Padrão coerente: vínculo, dado pessoal, isolamento, código sintético e migração de canal na mesma janela. Hipótese validada para fins de demonstração.");
    await m.page.getByTestId("confirm-action").click();
    await expect(m.page.getByTestId("case-view")).toContainText("Risco confirmado", { timeout: 20_000 });
    await expect(g.page.getByTestId("guardian-case")).toContainText("Risco confirmado", { timeout: 20_000 });

    // status dos serviços e custo medido na Central
    await expect(p.page.getByText("Status dos serviços")).toBeVisible();
    await expect(p.page.getByText(/pronta · claude|modo regras|plano B/)).toBeVisible();
    await expect(p.page.getByText(/Chamadas LLM/)).toBeVisible();

    await closeWorld(p.page);
    await Promise.all([a.context.close(), b.context.close(), g.context.close(), m.context.close(), p.context.close()]);
  });

  test("código de acesso errado é bloqueado no servidor", async ({ page }) => {
    requireCodes();
    await enterGame(page, "Intruso", "ERRADO-123");
    await expect(page.getByRole("alert")).toContainText(/inválido/i, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/entrar/);
    expect(GAME_ACCESS_CODE).not.toBe("ERRADO-123");
  });
});
