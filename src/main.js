import { stageProgress, chapterValues } from "./scroll-math.js";

const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const stageElements = [...document.querySelectorAll(".stage")];
const compositionRows = [...document.querySelectorAll(".composition-row")];
const hero = document.querySelector(".hero-stage");
const viewport = document.querySelector(".car-viewport");
const canvas = document.querySelector("#car-canvas");
const heroPin = document.querySelector(".hero-pin");
const bonnetHint = document.querySelector(".bonnet-hint-label");
const replayButton = document.querySelector(".replay-intro");
let sceneState = {
  engineOpen: false,
  effectsEnabled: true,
  opening: false,
  reducedMotion: motionPreference.matches,
};
let carScene;
let stageBounds = [];
let scrollFrame = 0;
let activeRow = -1;
let lastHeroProgress = 0;

// Keep emphasis and intentional line breaks while giving every word its own entrance.
function splitWords(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let index = 0;
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        fragment.append(document.createTextNode(part));
      } else {
        const word = document.createElement("span");
        word.className = "word";
        word.textContent = part;
        word.style.setProperty("--d", `${index++ * 38}ms`);
        fragment.append(word);
      }
    }
    node.replaceWith(fragment);
  }
}

document.querySelectorAll("[data-words]").forEach(splitWords);
const revealElements = [
  ...document.querySelectorAll("[data-rev], [data-words]"),
];
document.querySelectorAll("[data-rev]").forEach((element, index) => {
  element.style.setProperty("--d", `${(index % 5) * 65}ms`);
});
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in-view");
      revealObserver.unobserve(entry.target);
    }
  },
  { threshold: 0.12 },
);
revealElements.forEach((element) => revealObserver.observe(element));
document.documentElement.classList.add("js-ready");

function measureStages() {
  stageBounds = stageElements.map((element) => ({
    element,
    top: element.getBoundingClientRect().top + window.scrollY,
    height: element.offsetHeight,
    viewportHeight: element.querySelector(".pin").offsetHeight,
  }));
  scheduleScroll();
}

function updateScroll() {
  scrollFrame = 0;
  const scrollY = window.scrollY;
  for (const stage of stageBounds) {
    const p = motionPreference.matches
      ? 1
      : stageProgress(scrollY, stage.top, stage.height, stage.viewportHeight);
    stage.element.style.setProperty("--p", p.toFixed(4));
    const values = chapterValues(p);
    if (stage.element === hero) {
      stage.element.style.setProperty(
        "--hero-opacity",
        values.heroOpacity.toFixed(4),
      );
      lastHeroProgress = motionPreference.matches ? 0 : p;
      if (carScene) carScene.setProgress(lastHeroProgress);
    } else if (stage.element.classList.contains("reveal-stage")) {
      stage.element.style.setProperty(
        "--reveal-heading-opacity",
        values.headingOpacity.toFixed(4),
      );
      stage.element.style.setProperty(
        "--caption-opacity",
        values.captionOpacity.toFixed(4),
      );
    } else if (values.activeRow !== activeRow) {
      activeRow = values.activeRow;
      compositionRows.forEach((row, index) =>
        row.classList.toggle("active", index <= activeRow),
      );
    }
  }
}

function scheduleScroll() {
  if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScroll);
}
window.addEventListener("scroll", scheduleScroll, { passive: true });
window.addEventListener("resize", measureStages, { passive: true });
motionPreference.addEventListener("change", measureStages);
document.fonts.ready.then(measureStages);
measureStages();

function updateSceneState(state) {
  sceneState = state;
  heroPin.dataset.engine = state.engineOpen ? "open" : "closed";
  heroPin.dataset.opening = state.opening ? "playing" : "complete";
  heroPin.dataset.effects = state.effectsEnabled ? "on" : "off";
  heroPin.dataset.sceneMotion = state.settled ? "settled" : "moving";
  heroPin.dataset.smoke =
    state.effectsEnabled && !state.reducedMotion ? "active" : "paused";
  bonnetHint.textContent = state.engineOpen
    ? "Tap the bonnet to close"
    : "Tap the bonnet to open";
  document.querySelector("#engine-caption").hidden = !state.engineOpen;
  document.querySelector("#scene-status").textContent = state.opening
    ? "Opening sequence playing. You can drag the car to take control."
    : state.engineOpen
      ? "Bonnet open. BMW M4 CSL engine bay visible. Tap the bonnet or press Enter or Space to close."
      : "Bonnet closed. Tap the bonnet or press Enter or Space to open.";
}

function sceneReady(viewer) {
  viewport.setAttribute("aria-busy", "false");
  viewport.classList.add("loaded");
  document.querySelector(".scene-loading").hidden = true;
  document
    .querySelectorAll(".color-swatch, .reset-view, .scene-actions button")
    .forEach((button) => {
      button.disabled = false;
    });
  viewer.playIntro();
}
function sceneError(error) {
  if (viewport.classList.contains("failed")) return;
  console.warn(
    "The interactive scene is unavailable; showing the photographic view.",
    error,
  );
  viewport.setAttribute("aria-busy", "false");
  viewport.classList.add("failed");
  document.querySelector(".scene-loading").hidden = true;
  document.querySelector(".car-fallback").hidden = false;
  canvas.hidden = true;
  document.querySelector(".scene-controls").hidden = true;
  document.querySelector(".scene-actions").hidden = true;
  document.querySelector("#engine-caption").hidden = true;
  heroPin.dataset.opening = "unavailable";
  heroPin.dataset.engine = "closed";
  heroPin.dataset.smoke = "paused";
  document.querySelector("#scene-status").textContent =
    "3D unavailable. A photographic view is shown instead.";
  document.querySelector(".drag-prompt").textContent =
    "A study in pure driving pleasure";
}

async function loadScene() {
  try {
    const { initCarScene } = await import("./car-scene.js");
    carScene = await initCarScene({
      canvas,
      onReady: sceneReady,
      onError: sceneError,
      onStateChange: updateSceneState,
    });
    if (!carScene) return;
    carScene.setProgress(lastHeroProgress);
  } catch (error) {
    sceneError(error);
  }
}
loadScene();

replayButton.addEventListener("click", () => carScene?.playIntro());

document.querySelectorAll(".color-swatch").forEach((button) => {
  button.addEventListener("click", () => {
    if (!carScene) return;
    carScene.setColor(button.dataset.color);
    document.querySelectorAll(".color-swatch").forEach((swatch) => {
      const selected = swatch === button;
      swatch.classList.toggle("selected", selected);
      swatch.setAttribute("aria-pressed", String(selected));
    });
    document.querySelector("#paint-name").textContent = button.dataset.name;
  });
});
document.querySelector(".reset-view").addEventListener("click", () => {
  carScene?.reset();
});
canvas.addEventListener("keydown", (event) => {
  if (
    !carScene ||
    ![
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "Enter",
      " ",
      "p",
      "P",
    ].includes(event.key)
  )
    return;
  event.preventDefault();
  if (event.key === "Enter" || event.key === " ") {
    if (!event.repeat) carScene.setEngineOpen(!sceneState.engineOpen);
  } else if (event.key.toLowerCase() === "p") {
    if (!event.repeat) carScene.setEffects(!sceneState.effectsEnabled);
  } else if (event.key === "Home") {
    carScene.reset();
  } else {
    const steps = {
      ArrowLeft: [0.15, 0],
      ArrowRight: [-0.15, 0],
      ArrowUp: [0, -0.08],
      ArrowDown: [0, 0.08],
    };
    carScene.rotate(...steps[event.key]);
  }
});

const menuButton = document.querySelector(".menu-toggle");
const mobileMenu = document.querySelector("#mobile-nav");
function closeMenu(returnFocus = false) {
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open navigation");
  mobileMenu.hidden = true;
  if (returnFocus) menuButton.focus();
}
menuButton.addEventListener("click", () => {
  const opening = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(opening));
  menuButton.setAttribute(
    "aria-label",
    opening ? "Close navigation" : "Open navigation",
  );
  mobileMenu.hidden = !opening;
});
mobileMenu
  .querySelectorAll("a")
  .forEach((link) => link.addEventListener("click", () => closeMenu()));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mobileMenu.hidden) closeMenu(true);
});
document.addEventListener("click", (event) => {
  if (!mobileMenu.hidden && !event.target.closest(".site-header")) closeMenu();
});
window.matchMedia("(min-width: 701px)").addEventListener("change", (event) => {
  if (event.matches) closeMenu();
});

const credits = document.querySelector("#credits-dialog");
document
  .querySelector(".credits-button")
  .addEventListener("click", () => credits.showModal());
document
  .querySelector(".dialog-close")
  .addEventListener("click", () => credits.close());
credits.addEventListener("click", (event) => {
  if (event.target === credits) credits.close();
});
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) carScene?.dispose();
});
