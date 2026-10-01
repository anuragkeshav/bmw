import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createMetallicPaint, addReflectionCards } from "../src/car-paint.js";

test("all body finishes use polished metallic paint rather than matte shading", () => {
  for (const color of ["#aeb1a0", "#e3e2dd", "#414744"]) {
    const paint = createMetallicPaint(color);
    assert.equal(paint.isMeshPhysicalMaterial, true);
    assert.equal(paint.color.getHexString(), color.slice(1));
    assert.ok(paint.metalness >= 0.85);
    assert.ok(paint.roughness <= 0.16);
    assert.equal(paint.clearcoat, 1);
    assert.ok(paint.clearcoatRoughness <= 0.04);
    assert.ok(paint.envMapIntensity > 1);
    paint.dispose();
  }
});

test("studio reflection strips create highlights without adding car-scene objects", () => {
  const studio = new THREE.Scene();
  addReflectionCards(studio);
  assert.equal(studio.children.length, 2);
  for (const strip of studio.children) {
    assert.equal(strip.isMesh, true);
    assert.equal(strip.material.isMeshBasicMaterial, true);
    assert.ok(strip.material.color.r > 1);
    strip.geometry.dispose();
    strip.material.dispose();
  }
});
