import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const PRESENTER_SECRET = process.env.E2E_PRESENTER_SECRET ?? "";

export interface RoleLinks {
  playerA: string;
  playerB: string;
  guardian: string;
  moderator: string;
  sessionCode: string;
}

export async function openPresenter(page: Page): Promise<void> {
  expect(PRESENTER_SECRET, "E2E_PRESENTER_SECRET é obrigatório").not.toBe("");
  await page.goto("/demo");
  // limpa sessão anterior guardada no navegador
  await page.evaluate(() => {
    window.localStorage.removeItem("safe-play-demo-session");
    window.sessionStorage.removeItem("safe-play-presenter-code");
  });
  await page.reload();
  await page.getByTestId("presenter-code").fill(PRESENTER_SECRET);
  await page.getByTestId("presenter-enter").click();
}

export async function createSession(page: Page, scenario: "saudavel" | "progressivo" | "falso_positivo"): Promise<RoleLinks> {
  await openPresenter(page);
  await page.getByTestId(`create-${scenario}`).click();
  await expect(page.getByTestId("session-code")).toBeVisible({ timeout: 30_000 });
  const sessionCode = (await page.getByTestId("session-code").textContent())?.trim() ?? "";
  const href = async (key: string) => (await page.getByTestId(`link-${key}`).getAttribute("data-href")) ?? "";
  return { playerA: await href("player-0"), playerB: await href("player-1"), guardian: await href("guardian-0"), moderator: await href("moderator-0"), sessionCode };
}

export async function advance(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const btn = page.getByTestId("advance");
    await expect(btn).toBeEnabled({ timeout: 30_000 });
    await btn.click();
    // aguarda a chamada terminar (botão volta a ficar habilitado ou roteiro concluído)
    await expect(btn).not.toHaveText(/Enviando/, { timeout: 45_000 });
  }
}

export async function openRole(browser: Browser, url: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

export async function deleteSession(page: Page): Promise<void> {
  page.once("dialog", (d) => d.accept());
  const btn = page.getByRole("button", { name: "Apagar" });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}
