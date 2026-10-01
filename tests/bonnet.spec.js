import { test, expect } from "@playwright/test";

test.use({ hasTouch: true });

async function ready(page) {
  await page.goto("/");
  await expect(page.locator(".car-viewport")).toHaveClass(/loaded/, {
    timeout: 45000,
  });
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-opening",
    "complete",
    { timeout: 30000 },
  );
  await page.locator("#car-canvas").press("p");
  await page.getByRole("button", { name: "Reset 3D view" }).click();
}

async function settled(page, engine) {
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-engine",
    engine,
  );
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-scene-motion",
    "settled",
    { timeout: 20000 },
  );
}

// Find the actual raycast hover target, without a test-only API or invisible hit area.
async function bonnetPoint(page) {
  const canvas = page.locator("#car-canvas");
  const box = await canvas.boundingBox();
  for (const fy of [0.42, 0.34, 0.5, 0.58, 0.26, 0.66]) {
    for (const fx of [0.4, 0.35, 0.45, 0.3, 0.5, 0.55, 0.6]) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      await page.mouse.move(x, y);
      if (await canvas.evaluate((el) => el.style.cursor === "pointer"))
        return { x, y };
    }
  }
  throw new Error("The visible bonnet has no clickable surface.");
}

test("clicking the real bonnet opens and closes it, without separate toggle buttons", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await expect(page.locator(".engine-toggle, .effects-toggle")).toHaveCount(0);
  const canvas = page.locator("#car-canvas");
  let target = await bonnetPoint(page);
  await page.mouse.click(target.x, target.y);
  await settled(page, "open");
  await expect(page.locator("#engine-caption")).toBeVisible();
  target = await bonnetPoint(page);
  await page.mouse.click(target.x, target.y);
  await settled(page, "closed");
  await expect(page.locator("#engine-caption")).not.toBeVisible();
  // A door/body hit must not trigger the bonnet.
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.58);
  await settled(page, "closed");
  await canvas.press("ArrowRight");
  await canvas.press("ArrowRight");
  await page.waitForTimeout(300);
  target = await bonnetPoint(page);
  await page.mouse.click(target.x, target.y);
  await settled(page, "open");
  expect(errors).toEqual([]);
});

test("dragging from the bonnet or holding it does not accidentally open it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  let target = await bonnetPoint(page);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 28, target.y, { steps: 6 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  await settled(page, "closed");
  target = await bonnetPoint(page);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await settled(page, "closed");
  await page.mouse.click(target.x, target.y);
  await settled(page, "open");
});

test("touch taps operate both bonnet positions on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  let target = await bonnetPoint(page);
  await page.touchscreen.tap(target.x, target.y);
  await settled(page, "open");
  target = await bonnetPoint(page);
  await page.touchscreen.tap(target.x, target.y);
  await settled(page, "closed");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("keyboard bonnet controls work without motion and ignore key repeat", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  const canvas = page.locator("#car-canvas");
  await canvas.focus();
  await page.keyboard.down("Enter");
  await settled(page, "open");
  await page.keyboard.down("Enter");
  await settled(page, "open");
  await page.keyboard.up("Enter");
  await page.keyboard.press("Space");
  await settled(page, "closed");
  await expect(canvas).toHaveAttribute(
    "aria-describedby",
    "scene-help scene-status",
  );
  await expect(page.locator("#scene-help")).toContainText("Enter or Space");
});
