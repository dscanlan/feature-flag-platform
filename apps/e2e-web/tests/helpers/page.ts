import { expect, type Locator, type Page } from "@playwright/test";

export async function gotoHarness(page: Page, path: string = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("app-ready")).toHaveText("yes", { timeout: 15_000 });
}

export function banner(page: Page): Locator {
  return page.getByTestId("checkout-banner");
}

export function pricingCard(page: Page): Locator {
  return page.getByTestId("pricing-card");
}

export function connectionState(page: Page): Locator {
  return page.getByTestId("connection-state");
}

export function lastError(page: Page): Locator {
  return page.getByTestId("last-error");
}

export async function expectBanner(page: Page, state: "on" | "off", timeout = 5_000): Promise<void> {
  await expect(banner(page)).toHaveText(`new-checkout: ${state}`, { timeout });
}

export async function expectConnection(
  page: Page,
  state: "streaming" | "polling" | "offline",
  timeout = 7_000,
): Promise<void> {
  await expect(connectionState(page)).toHaveText(state, { timeout });
}

export async function pickUser(page: Page, userId: string): Promise<void> {
  await page.getByTestId("user-picker").selectOption(userId);
}

export async function pickTokenUser(page: Page, userId: string): Promise<void> {
  await page.getByTestId("token-user-picker").selectOption(userId);
}

export async function useRaw(page: Page): Promise<void> {
  await page.getByTestId("use-raw").click();
}

export async function useToken(page: Page): Promise<void> {
  await page.getByTestId("use-token").click();
}

export async function useBadToken(page: Page): Promise<void> {
  await page.getByTestId("use-bad-token").click();
}
