import { test, expect } from "@playwright/test";

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
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-scene-motion",
    "settled",
  );
}

async function settled(page) {
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-scene-motion",
    "settled",
    { timeout: 20000 },
  );
}

test("the cinematic entrance opens the actual bonnet and can be replayed or reversed", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  const pin = page.locator(".hero-pin");
  const canvas = page.locator("#car-canvas");
  await expect(pin).toHaveAttribute("data-engine", "open");
  await expect(page.locator("#engine-caption")).toBeVisible();
  await expect(page.locator("#scene-status")).toContainText(
    "engine bay visible",
  );
  await canvas.press("p");
  await settled(page);
  const engineView = await canvas.screenshot();
  await canvas.press("Enter");
  await settled(page);
  await expect(pin).toHaveAttribute("data-engine", "closed");
  await expect(page.locator("#engine-caption")).not.toBeVisible();
  expect(engineView.equals(await canvas.screenshot())).toBe(false);
  await canvas.press("Space");
  await settled(page);
  await expect(page.locator(".bonnet-hint")).toContainText(
    "Tap the bonnet to close",
  );
  await page.getByRole("button", { name: "Replay opening" }).click();
  await expect(pin).toHaveAttribute("data-opening", "playing");
  await expect(pin).toHaveAttribute("data-engine", "closed");
  await expect(pin).toHaveAttribute("data-opening", "complete", {
    timeout: 30000,
  });
  await expect(pin).toHaveAttribute("data-engine", "open");
  await page.getByRole("button", { name: "Reset 3D view" }).click();
  await expect(pin).toHaveAttribute("data-engine", "closed");
  await expect(pin).toHaveAttribute("data-effects", "off");
  expect(errors).toEqual([]);
});

test("light-red bands replace pink, and atmosphere can be paused", async ({
  page,
}) => {
  await ready(page);
  await expect(page.locator("#philosophy")).toHaveCSS(
    "background-color",
    "rgb(242, 185, 175)",
  );
  await expect(page.locator("#questions")).toHaveCSS(
    "background-color",
    "rgb(245, 199, 189)",
  );
  const pin = page.locator(".hero-pin");
  await expect(pin).toHaveAttribute("data-smoke", "active");
  await expect(page.locator(".effects-toggle, .engine-toggle")).toHaveCount(0);
  await page.locator("#car-canvas").press("p");
  await expect(pin).toHaveAttribute("data-smoke", "paused");
  await expect(pin).toHaveAttribute("data-effects", "off");
  await page.locator("#car-canvas").press("p");
  await expect(pin).toHaveAttribute("data-smoke", "active");
});

test("mobile reduced motion shows the engine immediately with all controls usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  const pin = page.locator(".hero-pin");
  await expect(pin).toHaveAttribute("data-engine", "open");
  await expect(pin).toHaveAttribute("data-smoke", "paused");
  await expect(page.locator(".ignition-sweep")).not.toBeVisible();
  const buttons = page.locator(".scene-actions button");
  for (const button of await buttons.all()) {
    await expect(button).toBeInViewport();
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.locator("#car-canvas").focus();
  await page.keyboard.press("Enter");
  await expect(pin).toHaveAttribute("data-engine", "closed");
  await page.getByRole("button", { name: "Replay opening" }).click();
  await expect(pin).toHaveAttribute("data-opening", "complete");
  await expect(pin).toHaveAttribute("data-engine", "open");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("changing the motion preference during the opening finishes cleanly", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "Replay opening" }).click();
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-opening",
    "playing",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-opening",
    "complete",
  );
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-engine",
    "open",
  );
  await expect(page.locator(".hero-pin")).toHaveAttribute(
    "data-smoke",
    "paused",
  );
});

test("the effects module actually advances smoke, pauses it, switches lights, and cleans up", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { createSceneEffects } = await import("/src/scene-effects.js");
    const parent = new THREE.Group();
    const effects = createSceneEffects({
      parent,
      headlights: [new THREE.Vector3(2, 0.6, 0.6)],
      exhausts: [new THREE.Vector3(-2, 0.3, 0)],
      forward: new THREE.Vector3(1, 0, 0),
    });
    const root = parent.getObjectByName("M4 scene atmosphere");
    const smoke = parent.getObjectByName("Exhaust wisps");
    const particle = smoke.children[0];
    effects.update(0.05, 1);
    const before = particle.position.clone();
    effects.update(0.1, 1.1);
    const moves = !particle.position.equals(before);
    const after = particle.position.clone();
    effects.update(0.1, 1.2, { reducedMotion: true });
    const reduced = !smoke.visible && particle.position.equals(after);
    effects.update(0.1, 1.3, { enabled: false });
    const lights = [];
    root.traverse((object) => {
      if (object.isLight) lights.push(object.intensity);
    });
    const disabled =
      !root.visible && lights.every((intensity) => intensity === 0);
    effects.update(0.05, 1.4, { enabled: true });
    const resumes = root.visible && smoke.visible;
    const count = smoke.children.length;
    effects.dispose();
    effects.dispose();
    return {
      moves,
      reduced,
      disabled,
      resumes,
      count,
      disposed: parent.children.length === 0,
    };
  });
  expect(result).toEqual({
    moves: true,
    reduced: true,
    disabled: true,
    resumes: true,
    count: 20,
    disposed: true,
  });
});
