import { expect, test } from "@playwright/test";

test.describe("Dashboard", () => {
  test("renders stat cards", async ({ page }) => {
    await page.goto("/dashboard");

    // Wait for dashboard to load
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    // Stat cards should render (look for common patterns)
    const main = page.getByRole("main");
    await expect(main.getByText(/sessions/i)).toBeVisible();
  });

  test("sidebar navigation works", async ({ page }) => {
    await page.goto("/dashboard");

    // Find sidebar link to Sessions
    const sessionsLink = page.getByRole("link", { name: /sessions/i });
    await expect(sessionsLink).toBeVisible();
    await sessionsLink.click();

    // Should navigate to sessions page
    await expect(page).toHaveURL(/\/dashboard\/sessions/);
  });
});
