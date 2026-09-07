import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const PRESENTER_SECRET = process.env.E2E_PRESENTER_SECRET ?? "";
export const GAME_ACCESS_CODE = process.env.E2E_GAME_ACCESS_CODE ?? "";
export const MODERATOR_CODE = process.env.E2E_MODERATOR_CODE ?? "";
export const GUARDIAN_CODE = process.env.E2E_GUARDIAN_CODE ?? "";

export function requireCodes(): void {
  expect(PRESENTER_SECRET, "E2E_PRESENTER_SECRET é obrigatório").not.toBe("");
  expect(GAME_ACCESS_CODE, "E2E_GAME_ACCESS_CODE é obrigatório").not.toBe("");
  expect(MODERATOR_CODE, "E2E_MODERATOR_CODE é obrigatório").not.toBe("");
  expect(GUARDIAN_CODE, "E2E_GUARDIAN_CODE é obrigatório").not.toBe("");
}

export async function newPage(browser: Browser, viewport?: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  return { context, page };
}

/** Tela inicial → Jogar → nome + código → lobby (ou mundo atual). */
export async function enterGame(page: Page, name: string, code = GAME_ACCESS_CODE): Promise<void> {
  await page.goto("/");
  await page.getByTestId("play").click();
  await page.getByTestId("player-name").fill(name);
  await page.getByTestId("access-code").fill(code);
  await page.getByTestId("enter").click();
}

/** Cria um mundo a partir do lobby e devolve o código (W-XXXX) lido da URL. */
export async function createWorld(page: Page, name: string): Promise<string> {
  await expect(page).toHaveURL(/\/lobby/, { timeout: 30_000 });
  await page.getByTestId("world-name").fill(name);
  await page.getByTestId("create-world").click();
  await expect(page).toHaveURL(/\/mundo\/W-[A-Z0-9]+/, { timeout: 30_000 });
  const m = page.url().match(/\/mundo\/(W-[A-Z0-9]+)/);
  return m?.[1] ?? "";
}

export async function joinWorld(page: Page, worldCode: string): Promise<void> {
  await expect(page).toHaveURL(/\/lobby/, { timeout: 30_000 });
  const item = page.locator(`[data-testid="world-item"][data-code="${worldCode}"]`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.getByTestId("join-world").click();
  await expect(page).toHaveURL(new RegExp(`/mundo/${worldCode}`), { timeout: 30_000 });
}

export async function loginRole(page: Page, path: "/moderacao" | "/responsavel" | "/apresentador", code: string, name?: string): Promise<void> {
  await page.goto(path);
  if (name) await page.getByTestId("role-name").fill(name);
  await page.getByTestId("role-code").fill(code);
  await page.getByTestId("role-enter").click();
}

export async function pickWorld(page: Page, worldCode: string): Promise<void> {
  const item = page.locator(`[data-testid="world-option"][data-code="${worldCode}"]`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.getByTestId("pick-world").click();
}

export async function presenterSelectWorld(page: Page, worldCode: string): Promise<void> {
  const item = page.locator(`[data-testid="presenter-world"][data-code="${worldCode}"]`);
  await expect(item).toBeVisible({ timeout: 30_000 });
  await item.click();
  await expect(page.getByTestId("advance")).toBeVisible({ timeout: 30_000 });
}

export async function advance(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const btn = page.getByTestId("advance");
    await expect(btn).toBeEnabled({ timeout: 30_000 });
    const before = (await btn.textContent()) ?? "";
    const m = before.match(/\((\d+)\/(\d+)\)/);
    const current = m ? Number(m[1]) : 0;
    const total = m ? Number(m[2]) : 0;
    await btn.click();
    if (m && current < total) {
      await expect(btn).toHaveText(new RegExp(`\\(${current + 1}/${total}\\)|Roteiro concluído`), { timeout: 60_000 });
    } else {
      await expect(btn).not.toHaveText(/Enviando/, { timeout: 60_000 });
    }
  }
}

/** Encerra o mundo pela Central (limpa o lobby para a próxima execução). */
export async function closeWorld(page: Page): Promise<void> {
  page.once("dialog", (d) => d.accept());
  const btn = page.getByRole("button", { name: "Encerrar mundo" });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}
