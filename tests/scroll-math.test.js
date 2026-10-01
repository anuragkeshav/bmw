import test from "node:test";
import assert from "node:assert/strict";
import { clamp, stageProgress, chapterValues } from "../src/scroll-math.js";

test("scroll progress stays in bounds before and after a stage", () => {
  assert.equal(stageProgress(0, 100, 2400, 800), 0);
  assert.equal(stageProgress(100, 100, 2400, 800), 0);
  assert.equal(stageProgress(900, 100, 2400, 800), 0.5);
  assert.equal(stageProgress(5000, 100, 2400, 800), 1);
});

test("short and reduced-motion stages do not divide by zero", () => {
  assert.equal(stageProgress(0, 100, 800, 800), 0);
  assert.equal(stageProgress(100, 100, 800, 800), 1);
  assert.equal(stageProgress(150, 100, 400, 800), 1);
});

test("the image caption is hidden until the reveal is 45 percent complete", () => {
  assert.equal(chapterValues(0).captionOpacity, 0);
  assert.equal(chapterValues(0.45).captionOpacity, 0);
  assert.ok(Math.abs(chapterValues(0.6).captionOpacity - 0.5) < 0.00001);
  assert.equal(chapterValues(0.75).captionOpacity, 1);
  assert.equal(chapterValues(1).captionOpacity, 1);
});

test("specifications light cumulatively at each quarter of the stage", () => {
  assert.deepEqual(
    [0, 0.249, 0.25, 0.5, 0.75, 1].map((p) => chapterValues(p).activeRow),
    [0, 0, 1, 2, 3, 3],
  );
});

test("headlines are readable initially and fade as scenes finish", () => {
  assert.equal(chapterValues(0).heroOpacity, 1);
  assert.equal(chapterValues(1).heroOpacity, 0);
  assert.equal(chapterValues(0.55).headingOpacity, 1);
  assert.equal(chapterValues(1).headingOpacity, 0);
});

test("clamp supports keyboard offsets and normal progress", () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(5), 1);
  assert.equal(clamp(0.5), 0.5);
  assert.equal(clamp(-0.5, -1, 1), -0.5);
});
