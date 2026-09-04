import { expect, test } from "@playwright/test";
import { advance, createSession, deleteSession, openRole } from "./helpers";

test.describe("cenário progressivo em três+ navegadores", () => {
  test("conversa real → padrão acumulado → alerta → caso único → decisão humana → auditoria", async ({ browser, page }) => {
    const links = await createSession(page, "progressivo");

    const a = await openRole(browser, links.playerA);
    const b = await openRole(browser, links.playerB);
    const g = await openRole(browser, links.guardian);
    const m = await openRole(browser, links.moderator);

    // chat: entrada e presença para 3 clientes (A, B e um segundo A em outra aba)
    await expect(a.page.getByRole("log")).toBeVisible({ timeout: 30_000 });
    await expect(b.page.getByRole("log")).toBeVisible({ timeout: 30_000 });
    const a2 = await openRole(browser, links.playerA);
    await expect(a2.page.getByRole("log")).toBeVisible({ timeout: 30_000 });
    await expect(a.page.getByTitle("Participantes online")).toContainText(/[23] online/, { timeout: 20_000 });

    // digitação em tempo real
    await b.page.getByLabel("Mensagem").fill("oi Nico");
    await expect(a.page.getByText(/digitando/)).toBeVisible({ timeout: 10_000 });

    // mensagem propagada sem refresh. Primeira mensagem tolera cold start da Edge Function (8 s);
    // a segunda mede o caminho quente (< 3 s de tolerância; meta < 1 s em conexão estável)
    const t0 = Date.now();
    await b.page.getByLabel("Mensagem").press("Enter");
    await expect(a.page.getByRole("log")).toContainText("oi Nico", { timeout: 8_000 });
    console.log(`entrega B→A (fria): ${Date.now() - t0} ms`);
    await expect(a2.page.getByRole("log")).toContainText("oi Nico", { timeout: 3_000 });

    // idempotência/duplicidade: a mesma mensagem não aparece duas vezes
    await expect(a.page.getByRole("log").getByText("oi Nico", { exact: true })).toHaveCount(1);

    // resposta humana de A (caminho quente)
    await a.page.getByLabel("Mensagem").fill("oi!! bora jogar?");
    const t1 = Date.now();
    await a.page.getByLabel("Mensagem").press("Enter");
    await expect(b.page.getByRole("log")).toContainText("bora jogar?", { timeout: 3_000 });
    console.log(`entrega A→B (quente): ${Date.now() - t1} ms`);

    // roteiro sintético: até a mensagem 9 (esperado: Alto + caso)
    await advance(page, 9);
    await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", /alto|critico/, { timeout: 30_000 });
    await expect(g.page.getByTestId("alert-list")).toBeVisible();
    await expect(m.page.getByTestId("case-item")).toHaveCount(1, { timeout: 30_000 });

    // Safety Pulse: padrão acumulado > mensagem isolada; chips de sinais
    await expect(g.page.getByTestId("signal-chips")).toBeVisible();
    const score = Number(await g.page.getByTestId("safety-pulse").getAttribute("data-score"));
    expect(score).toBeGreaterThanOrEqual(50);

    // restante do roteiro: crítico, ainda um único caso
    await advance(page, 5);
    await expect(g.page.getByTestId("guardian-state")).toHaveAttribute("data-level", "critico", { timeout: 30_000 });
    await m.page.getByLabel("Filtrar por status").selectOption("todos");
    await expect(m.page.getByTestId("case-item")).toHaveCount(1);
    await expect(m.page.getByTestId("case-item").first()).toContainText("P1");

    // explicação por evidências
    await g.page.getByTestId("explain-button").click();
    await expect(g.page.getByTestId("transparency-body")).toContainText("Explicação baseada em evidências");
    await expect(g.page.getByTestId("transparency-body")).toContainText("rules-");
    await g.page.keyboard.press("Escape");

    // decisão humana com justificativa obrigatória
    await m.page.getByTestId("action-confirm").click();
    await m.page.getByTestId("confirm-action").click();
    await expect(m.page.getByText(/justificativa é obrigatória/i)).toBeVisible();
    await m.page.getByTestId("justification").fill("Padrão coerente: vínculo, dado pessoal, isolamento, código sintético e migração de canal na mesma janela. Hipótese validada para fins de demonstração.");
    await m.page.getByTestId("confirm-action").click();
    await expect(m.page.getByTestId("case-view")).toContainText("Risco confirmado", { timeout: 20_000 });

    // a decisão aparece no painel do responsável e na auditoria
    await expect(g.page.getByTestId("guardian-case")).toContainText("Risco confirmado", { timeout: 20_000 });
    await expect(g.page.getByTestId("guardian-case")).toContainText("Padrão coerente");
    await g.page.getByTestId("explain-button").click();
    await expect(g.page.getByTestId("transparency-body")).toContainText("case.confirm_risk");

    // métricas medidas na central
    await expect(page.getByText(/Chamadas LLM/)).toBeVisible();

    await Promise.all([a.context.close(), a2.context.close(), b.context.close(), g.context.close(), m.context.close()]);
    await deleteSession(page);
  });
});
