import * as THREE from "three";

const SMOKE_COUNT = 20;
const TAU = Math.PI * 2;

// Local, repeatable randomness: neither construction nor respawning uses Math.random.
function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Scene effects require a 2D canvas context.");
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createHaloTexture() {
  return canvasTexture(64, (context, size) => {
    const middle = size / 2;
    const glow = context.createRadialGradient(
      middle,
      middle,
      0,
      middle,
      middle,
      middle,
    );
    glow.addColorStop(0, "rgba(255, 248, 214, 0.96)");
    glow.addColorStop(0.13, "rgba(255, 237, 179, 0.68)");
    glow.addColorStop(0.34, "rgba(228, 183, 110, 0.24)");
    glow.addColorStop(0.68, "rgba(197, 137, 84, 0.065)");
    glow.addColorStop(1, "rgba(197, 137, 84, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
  });
}

function createSmokeTexture() {
  const random = seededRandom(0x4d344353);
  const grid = 32;
  const noise = Float32Array.from({ length: grid * grid }, random);
  const smooth = (value) => value * value * (3 - 2 * value);
  const sample = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const at = (dx, dy) =>
      noise[((iy + dy) % grid) * grid + ((ix + dx) % grid)];
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(at(0, 0), at(1, 0), fx),
      THREE.MathUtils.lerp(at(0, 1), at(1, 1), fx),
      fy,
    );
  };

  return canvasTexture(128, (context, size) => {
    const pixels = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / (size - 1);
        const v = y / (size - 1);
        const nx = u * 2 - 1;
        const ny = v * 2 - 1;
        const edge = Math.max(0, 1 - nx * nx - ny * ny);
        // Stretched, layered noise breaks the silhouette into feathered wisps,
        // rather than the stacked circles of a typical exhaust particle texture.
        const billow =
          sample(u * 5 + 2, v * 7 + 3) * 0.56 +
          sample(u * 11 + 1, v * 17 + 1) * 0.29 +
          sample(u * 23, v * 29) * 0.15;
        const curl = 0.72 + Math.sin(v * 31 + u * 9 + billow * 8) * 0.28;
        const alpha =
          edge * edge * smooth(Math.max(0, (billow - 0.22) / 0.78)) * curl;
        const index = (y * size + x) * 4;
        pixels.data[index] = 255;
        pixels.data[index + 1] = 255;
        pixels.data[index + 2] = 255;
        pixels.data[index + 3] = Math.round(alpha * 255);
      }
    }
    context.putImageData(pixels, 0, 0);
  });
}

/**
 * Attach local-space atmosphere to the car, after measuring its framing bounds.
 * The host owns scheduling; call update before rendering, using seconds.
 * Only smoke animates. Disabled/reduced-motion updates never advance its clock.
 */
export function createSceneEffects({
  parent,
  headlights = [],
  exhausts = [],
  forward,
}) {
  if (!parent?.isObject3D) {
    throw new TypeError("Scene effects require a Three.js parent object.");
  }
  if (
    !forward?.isVector3 ||
    !Number.isFinite(forward.lengthSq()) ||
    forward.lengthSq() === 0
  ) {
    throw new TypeError("Scene effects require a nonzero forward Vector3.");
  }

  const ahead = forward.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(ahead.dot(up)) > 0.99) up.set(0, 0, 1);
  const side = new THREE.Vector3().crossVectors(ahead, up).normalize();
  up.crossVectors(side, ahead).normalize();
  const root = new THREE.Group();
  root.name = "M4 scene atmosphere";
  const smoke = new THREE.Group();
  smoke.name = "Exhaust wisps";
  root.add(smoke);

  const textures = new Set();
  const materials = new Set();
  const lamps = [];
  const lights = [];
  const particles = [];
  const random = seededRandom(0x4d344353);
  let disposed = false;
  let smokeTime = 0;

  function addLight(light, intensity) {
    light.castShadow = false;
    lights.push({ light, intensity });
    root.add(light);
  }

  if (headlights.length) {
    const haloTexture = createHaloTexture();
    textures.add(haloTexture);
    const haloMaterial = new THREE.SpriteMaterial({
      map: haloTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      // Normal blending retains a honey-coloured fringe on the paper background;
      // additive white would disappear under the canvas' CSS multiply blend.
      blending: THREE.NormalBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    materials.add(haloMaterial);
    for (const position of headlights) {
      const halo = new THREE.Sprite(haloMaterial);
      halo.name = "Warm headlamp halo";
      halo.position.copy(position).addScaledVector(ahead, 0.035);
      halo.scale.set(0.39, 0.29, 1);
      root.add(halo);
      lamps.push(halo);

      const light = new THREE.PointLight(0xffedc9, 0.85, 1.7, 2);
      light.name = "Headlamp reflection";
      light.position.copy(position).addScaledVector(ahead, 0.15);
      addLight(light, 0.85);
    }
  }

  const rear = new THREE.Vector3();
  if (exhausts.length) {
    for (const position of exhausts) rear.add(position);
    rear.multiplyScalar(1 / exhausts.length);
  } else if (headlights.length) {
    for (const position of headlights) rear.add(position);
    rear.multiplyScalar(1 / headlights.length).addScaledVector(ahead, -4.3);
  } else {
    rear.addScaledVector(ahead, -2.2).addScaledVector(up, 0.3);
  }

  const rim = new THREE.DirectionalLight(0xffbd91, 0.85);
  rim.name = "Warm rear rim";
  rim.position
    .copy(rear)
    .addScaledVector(ahead, -1.3)
    .addScaledVector(side, 2.2)
    .addScaledVector(up, 2.4);
  rim.target.position
    .copy(rear)
    .addScaledVector(ahead, 2)
    .addScaledVector(up, 0.55);
  root.add(rim.target);
  addLight(rim, 0.85);

  const redRim = new THREE.PointLight(0xff4938, 3.4, 4.2, 2);
  redRim.name = "Red rear-quarter reflection";
  redRim.position
    .copy(rear)
    .addScaledVector(ahead, -0.35)
    .addScaledVector(side, -1.05)
    .addScaledVector(up, 0.85);
  addLight(redRim, 3.4);

  if (exhausts.length) {
    const smokeTexture = createSmokeTexture();
    textures.add(smokeTexture);
    for (let index = 0; index < SMOKE_COUNT; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: smokeTexture,
        color: 0x8c7975,
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      materials.add(material);
      const sprite = new THREE.Sprite(material);
      sprite.name = "Exhaust wisp";
      smoke.add(sprite);
      const life = 2.6 + random() * 1.1;
      particles.push({
        sprite,
        origin: exhausts[index % exhausts.length].clone(),
        life,
        age: life * ((index + random() * 0.45) / SMOKE_COUNT),
        speed: 0.36 + random() * 0.24,
        lift: 0.08 + random() * 0.055,
        spread: (random() - 0.5) * 0.13,
        phase: random() * TAU,
        rotation: random() * TAU,
        spin: (random() - 0.5) * 0.2,
        size: 0.8 + random() * 0.4,
        opacity: 0.38 + random() * 0.12,
      });
    }
  }

  function update(
    deltaSeconds,
    _elapsedSeconds,
    { enabled = true, reducedMotion = false, intro = 1 } = {},
  ) {
    if (disposed) return;
    const reveal = Number.isFinite(intro)
      ? THREE.MathUtils.clamp(intro, 0, 1)
      : 1;
    const strength = enabled ? reveal : 0;
    root.visible = strength > 0;
    for (const { light, intensity } of lights)
      light.intensity = intensity * strength;
    // All halos share one material; lighting is deliberately steady, not pulsing.
    if (lamps.length) lamps[0].material.opacity = 0.72 * strength;
    smoke.visible = enabled && !reducedMotion && reveal > 0;
    if (!smoke.visible) return;

    // A tab returning after a long pause must not emit a burst or jump the plume.
    const dt = Number.isFinite(deltaSeconds)
      ? THREE.MathUtils.clamp(deltaSeconds, 0, 0.1)
      : 0;
    smokeTime += dt;
    for (const particle of particles) {
      particle.age = (particle.age + dt) % particle.life;
      const age = particle.age;
      const progress = age / particle.life;
      const wander = Math.sin(smokeTime * 0.62 + particle.phase + age * 1.6);
      const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.14);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.38, 1);
      const { sprite } = particle;
      sprite.position
        .copy(particle.origin)
        .addScaledVector(ahead, -(0.035 + age * particle.speed))
        .addScaledVector(up, age * particle.lift + age * age * 0.017)
        .addScaledVector(side, age * particle.spread + wander * age * 0.045);
      const size = (0.14 + age * 0.23) * particle.size;
      sprite.scale.set(size * 1.35, size * 0.8, 1);
      sprite.material.rotation = particle.rotation + age * particle.spin;
      sprite.material.opacity = particle.opacity * fadeIn * fadeOut * reveal;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    // Sprite's quad geometry belongs to Three.js and is shared globally. There
    // is no module-owned geometry to dispose, and releasing that quad would
    // invalidate unrelated sprites in the host scene.
    smoke.clear();
    root.clear();
    particles.length = lamps.length = lights.length = 0;
    materials.clear();
    textures.clear();
  }

  update(0, 0);
  parent.add(root);
  return { update, dispose };
}
