import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`the collection is a price-free portfolio showcase at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page
      .getByRole("link", { name: "View the collection", exact: true })
      .click();
    await expect(page.locator("#collection-title")).toBeInViewport();
    const text = await page.locator("body").textContent();
    expect(text).not.toMatch(
      /[$€£]\s*\d|\bMSRP\b|From\s*\/\s*USD|Make it yours|Find your BMW Center/i,
    );
    await expect(page.locator(".price")).toHaveCount(0);
    await expect(
      page.locator('a[href*="build-your-own"], a[href*="dealer-locator"]'),
    ).toHaveCount(0);
    await expect(page.locator(".model-row")).toHaveCount(3);
    await expect(
      page.locator('.table-header [role="columnheader"]'),
    ).toHaveCount(3);
    for (const row of await page.locator(".model-row").all()) {
      await expect(row.locator('[role="cell"]')).toHaveCount(3);
      const bounds = await row.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await expect(page.locator(".collection-foot")).toContainText(
      "Independent portfolio study",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("link", { name: "Explore in 3D", exact: false })
      .click();
    await expect(page.locator("#hero-title")).toBeInViewport();
  });
}
