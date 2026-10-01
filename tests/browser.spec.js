import { test, expect } from "@playwright/test";

async function loaded(page) {
  await page.goto("/");
  await expect(page.locator(".car-viewport")).toHaveClass(/loaded/, {
    timeout: 45000,
  });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-opening",
    "complete",
    { timeout: 30000 },
  );
  await page.locator("#car-canvas").press("p");
  await page.getByRole("button", { name: "Reset 3D view" }).click();
}

async function scrollStage(page, selector, progress) {
  await page.evaluate(
    ({ selector, progress }) => {
      const stage = document.querySelector(selector);
      const y =
        stage.getBoundingClientRect().top +
        scrollY +
        (stage.offsetHeight - stage.querySelector(".pin").offsetHeight) *
          progress;
      window.scrollTo({ top: y, behavior: "instant" });
    },
    { selector, progress },
  );
  await expect
    .poll(async () => {
      const actual = await page
        .locator(selector)
        .evaluate((el) => Number(el.style.getPropertyValue("--p")));
      return Math.abs(actual - progress);
    })
    .toBeLessThan(0.002);
}

test("real model loads, paint updates, and pointer/keyboard interactions change the view", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loaded(page);
  const canvas = page.locator("#car-canvas");
  await expect(
    page.getByRole("button", { name: "Sage metallic", exact: true }),
  ).toBeEnabled();
  const sage = await canvas.screenshot();
  await page
    .getByRole("button", { name: "Graphite metallic", exact: true })
    .click();
  await expect(page.locator("#paint-name")).toHaveText("Graphite metallic");
  await expect(
    page.getByRole("button", { name: "Graphite metallic", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(400);
  const graphite = await canvas.screenshot();
  expect(sage.equals(graphite)).toBe(false);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55, {
    steps: 15,
  });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(graphite.equals(await canvas.screenshot())).toBe(false);
  await canvas.focus();
  const beforeKey = await canvas.screenshot();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  expect(beforeKey.equals(await canvas.screenshot())).toBe(false);
  await page.getByRole("button", { name: "Reset 3D view" }).click();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("the reveal is bottom-up and composition rows activate cumulatively", async ({
  page,
}) => {
  await loaded(page);
  await scrollStage(page, ".reveal-stage", 0.25);
  const early = await page
    .locator(".reveal-photo")
    .evaluate((el) => getComputedStyle(el).clipPath);
  expect(Math.abs(parseFloat(early.replace("inset(", "")) - 75)).toBeLessThan(
    0.1,
  );
  expect(
    await page
      .locator(".reveal-caption")
      .evaluate((el) => Number(getComputedStyle(el).opacity)),
  ).toBe(0);
  await scrollStage(page, ".reveal-stage", 0.75);
  expect(
    await page
      .locator(".reveal-caption")
      .evaluate((el) => Number(getComputedStyle(el).opacity)),
  ).toBeGreaterThan(0.98);
  await scrollStage(page, ".composition-stage", 0.1);
  await expect(page.locator(".composition-row.active")).toHaveCount(1);
  await scrollStage(page, ".composition-stage", 0.55);
  await expect(page.locator(".composition-row.active")).toHaveCount(3);
  await scrollStage(page, ".composition-stage", 0.95);
  await expect(page.locator(".composition-row.active")).toHaveCount(4);
});

test("FAQ, official model links, and credits are usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loaded(page);
  await page.getByRole("link", { name: "View the collection" }).click();
  await expect(page.locator("#collection-title")).toBeInViewport();
  const modelLinks = page.locator(".model-row");
  await expect(modelLinks).toHaveCount(3);
  for (const link of await modelLinks.all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\/www\.bmwusa\.com\//);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  const question = page.locator("summary").first();
  await question.scrollIntoViewIfNeeded();
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details").first()).toHaveAttribute("open", "");
  await expect(
    page.getByRole("link", { name: "Start exploring" }),
  ).toBeVisible();
  await question.click();
  await expect(page.locator("details").first()).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Credits & information" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("mobile navigation and every section fit a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loaded(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("#mobile-nav")).toBeVisible();
  await page
    .locator("#mobile-nav")
    .getByRole("link", { name: "The collection" })
    .click();
  await expect(page.locator("#mobile-nav")).not.toBeVisible();
  await expect(page.locator("#collection-title")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const selector of [
    "#philosophy",
    "#experience",
    "#composition",
    "#collection",
    "#questions",
  ]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.x).toBeGreaterThanOrEqual(0);
  }
});

test("reduced motion reveals photographs and keeps the headline visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loaded(page);
  await expect(page.locator(".reveal-photo")).toHaveCSS("clip-path", "none");
  await expect(page.locator(".reveal-headline")).toHaveCSS(
    "mix-blend-mode",
    "normal",
  );
  await expect(page.locator(".reveal-headline")).toHaveCSS("opacity", "1");
  await expect(page.locator(".reveal-caption")).toHaveCSS("opacity", "1");
  await expect(page.locator(".hero-type")).toHaveCSS("opacity", "1");
  expect(
    await page.locator(".hero-stage").evaluate((el) => el.offsetHeight),
  ).toBeLessThanOrEqual(1000);
  const canvas = page.locator("#car-canvas");
  await canvas.focus();
  const original = await canvas.screenshot();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  expect(original.equals(await canvas.screenshot())).toBe(false);
});

test("failed 3D downloads leave a useful photographic fallback", async ({
  page,
}) => {
  await page.route("**/*.glb", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(".car-viewport")).toHaveClass(/failed/, {
    timeout: 30000,
  });
  await expect(page.locator(".car-fallback")).toBeVisible();
  await expect(page.locator(".scene-controls")).not.toBeVisible();
  await expect(page.locator("#car-canvas")).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "View the collection" }),
  ).toBeVisible();
});
