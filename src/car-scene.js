import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createSceneEffects } from "./scene-effects.js";
import { createMetallicPaint, addReflectionCards } from "./car-paint.js";

const DEFAULT_PAINT = "#aeb1a0";
const MODEL_URL = `${import.meta.env.BASE_URL}models/bmw-m4-csl.glb`;
const HOME_DIRECTION = new THREE.Vector3(6.8, 2.8, -8.4).normalize();

/**
 * Mount the self-contained, transparent M4 viewer onto an existing sized canvas.
 * Resolves after the model is ready. onReady receives the same controller.
 * Errors call onError(error) and reject the promise; callers should catch it.
 * The canvas' CSS controls its dimensions. No page-level scroll listeners are added.
 */
export async function initCarScene({
  canvas,
  onReady,
  onError,
  onStateChange,
} = {}) {
  let renderer;
  let controls;
  let environment;
  let resizeObserver;
  let visibilityObserver;
  let scene;
  let camera;
  let car;
  let frame = 0;
  let lastTime = 0;
  let disposed = false;
  let ready = false;
  let inView = true;
  let contextLost = false;
  let dragging = false;
  let progress = 0;
  let targetTurn = 0;
  let loadTimer;
  let hoodPivot;
  let engineOpen = false;
  let hoodAmount = 0;
  let atmosphere;
  let effectsEnabled = true;
  let elapsed = 0;
  let introElapsed = 0;
  let introActive = false;
  let opening = false;
  let settled = true;
  let viewTransition;
  let engineTarget;
  let previousWidth = 0;
  let previousHeight = 0;
  let previousDpr = 0;
  let tapCandidate = null;
  const activePointers = new Set();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const bonnetMeshes = new Set();
  const pickableMeshes = [];
  const headlightMaterials = new Set();
  const closedBounds = new THREE.Box3();
  const abortController = new AbortController();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const paintMaterials = new Set();
  const bounds = new THREE.Box3();
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  const originalTouchAction = canvas?.style?.touchAction;
  const originalCursor = canvas?.style?.cursor;

  function rememberMaterial(material) {
    materials.add(material);
    for (const value of Object.values(material)) {
      if (value?.isTexture) textures.add(value);
    }
  }

  function requestRender() {
    if (
      !frame &&
      ready &&
      !disposed &&
      inView &&
      !document.hidden &&
      !contextLost
    ) {
      frame = requestAnimationFrame(render);
    }
  }

  function stopRendering() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function render(time) {
    frame = 0;
    if (disposed || !inView || document.hidden || contextLost) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.5) : 1 / 60;
    lastTime = time;
    elapsed += dt;
    if (introActive) {
      introElapsed += dt;
      const p = THREE.MathUtils.clamp(introElapsed / 1.6, 0, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      car.rotation.y = 0.35 * (1 - ease);
      car.position.y = -0.08 * (1 - ease);
      if (p === 1) {
        introActive = false;
        car.position.y = 0;
        setEngineOpen(true);
      }
    } else {
      const remaining = targetTurn - car.rotation.y;
      car.rotation.y += remaining * (reducedMotion ? 1 : 1 - Math.exp(-dt * 4));
      if (Math.abs(remaining) < 0.0001) car.rotation.y = targetTurn;
    }
    const desiredHood = engineOpen ? 1 : 0;
    hoodAmount +=
      (desiredHood - hoodAmount) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 5));
    if (Math.abs(desiredHood - hoodAmount) < 0.001) hoodAmount = desiredHood;
    if (hoodPivot) hoodPivot.rotation.z = hoodAmount * 1.12;
    if (viewTransition) {
      viewTransition.elapsed += dt;
      const p = reducedMotion ? 1 : Math.min(1, viewTransition.elapsed / 1.3);
      const ease = 1 - Math.pow(1 - p, 3);
      camera.position.lerpVectors(
        viewTransition.fromPosition,
        viewTransition.position,
        ease,
      );
      controls.target.lerpVectors(
        viewTransition.fromTarget,
        viewTransition.target,
        ease,
      );
      if (p === 1) viewTransition = null;
    }
    if (
      (!settled || opening) &&
      !introActive &&
      !viewTransition &&
      hoodAmount === desiredHood
    ) {
      opening = false;
      settled = true;
      emitState();
    }
    atmosphere?.update(dt, elapsed, {
      enabled: effectsEnabled,
      reducedMotion,
      intro: introActive ? Math.min(1, introElapsed / 1.2) : 1,
    });
    const cameraMoving = controls.update();
    renderer.render(scene, camera);
    if (
      cameraMoving ||
      introActive ||
      viewTransition ||
      hoodAmount !== desiredHood ||
      (effectsEnabled && !reducedMotion) ||
      Math.abs(targetTurn - car.rotation.y) > 0.0001 ||
      dragging
    ) {
      requestRender();
    } else {
      lastTime = 0;
    }
  }

  function fitCamera(direction = null) {
    if (!car) return;
    const view =
      direction?.clone() ||
      camera.position.clone().sub(controls.target).normalize();
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), view)
      .normalize();
    const up = new THREE.Vector3().crossVectors(view, right).normalize();
    const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanHorizontal = tanVertical * camera.aspect;
    const point = new THREE.Vector3();
    let distance = 0;
    // Fit all eight corners, not just the long axis; narrow canvases remain uncropped.
    for (let i = 0; i < 8; i += 1) {
      point
        .set(
          i & 1 ? bounds.max.x : bounds.min.x,
          i & 2 ? bounds.max.y : bounds.min.y,
          i & 4 ? bounds.max.z : bounds.min.z,
        )
        .sub(controls.target);
      const depth = point.dot(view);
      distance = Math.max(
        distance,
        Math.abs(point.dot(right)) / tanHorizontal + depth,
        Math.abs(point.dot(up)) / tanVertical + depth,
      );
    }
    camera.position.copy(controls.target).addScaledVector(view, distance * 1.1);
    camera.near = 0.1;
    camera.far = Math.max(80, distance * 5);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
  }

  function resize() {
    if (disposed || !renderer) return;
    const width = Math.max(
      1,
      canvas.clientWidth || canvas.parentElement?.clientWidth || 1,
    );
    const height = Math.max(
      1,
      canvas.clientHeight || canvas.parentElement?.clientHeight || 1,
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    if (
      width === previousWidth &&
      height === previousHeight &&
      dpr === previousDpr
    )
      return;
    previousWidth = width;
    previousHeight = height;
    previousDpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (ready && opening) {
      viewTransition = null;
      introActive = false;
      opening = false;
      car.position.y = 0;
      hoodAmount = engineOpen ? 1 : 0;
      if (hoodPivot) hoodPivot.rotation.z = hoodAmount * 1.12;
      emitState();
    }
    fitCamera();
    requestRender();
  }

  function emitState() {
    onStateChange?.({
      engineOpen,
      opening,
      settled,
      effectsEnabled,
      reducedMotion,
    });
  }

  function focusEngine(open, instant = false) {
    const fromPosition = camera.position.clone();
    const fromTarget = controls.target.clone();
    bounds.copy(closedBounds);
    if (open) bounds.max.y += 0.65;
    controls.target.copy(
      open
        ? engineTarget
        : new THREE.Vector3(
            0,
            (closedBounds.max.y + closedBounds.min.y) * 0.5,
            0,
          ),
    );
    fitCamera(
      open ? new THREE.Vector3(6.8, 6.2, -8.4).normalize() : HOME_DIRECTION,
    );
    const position = camera.position.clone();
    const target = controls.target.clone();
    if (instant || reducedMotion) {
      viewTransition = null;
    } else {
      camera.position.copy(fromPosition);
      controls.target.copy(fromTarget);
      viewTransition = {
        fromPosition,
        fromTarget,
        position,
        target,
        elapsed: 0,
      };
    }
  }

  function setEngineOpen(open) {
    if (disposed || !ready) return;
    engineOpen = Boolean(open);
    introActive = false;
    car.position.y = 0;
    targetTurn = 0;
    focusEngine(engineOpen);
    settled = reducedMotion;
    if (reducedMotion) {
      hoodAmount = engineOpen ? 1 : 0;
      hoodPivot.rotation.z = hoodAmount * 1.12;
      opening = false;
    }
    emitState();
    requestRender();
  }

  function setEffects(enabled) {
    effectsEnabled = Boolean(enabled);
    for (const material of headlightMaterials)
      material.emissiveIntensity = effectsEnabled ? 3.5 : 0.15;
    emitState();
    requestRender();
  }

  function playIntro() {
    if (disposed || !ready) return;
    viewTransition = null;
    engineOpen = false;
    hoodAmount = 0;
    hoodPivot.rotation.z = 0;
    car.position.y = 0;
    car.rotation.y = 0;
    targetTurn = 0;
    focusEngine(false, true);
    introElapsed = 0;
    opening = !reducedMotion;
    settled = reducedMotion;
    introActive = !reducedMotion;
    if (reducedMotion) setEngineOpen(true);
    emitState();
    requestRender();
  }

  function setProgress(value) {
    if (disposed || !Number.isFinite(value)) return;
    progress = THREE.MathUtils.clamp(value, 0, 1);
    // Keep the engine reveal still; the closed body follows the scroll chapter.
    targetTurn =
      reducedMotion || engineOpen || introActive ? 0 : -progress * 0.42;
    requestRender();
  }

  function setColor(hex) {
    if (disposed) return;
    if (typeof hex !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) {
      throw new TypeError('setColor expects a CSS hex color, e.g. "#949f91".');
    }
    for (const material of paintMaterials) material.color.set(hex);
    requestRender();
  }

  function rotate(azimuth = 0, polar = 0) {
    if (
      disposed ||
      !ready ||
      !Number.isFinite(azimuth) ||
      !Number.isFinite(polar)
    )
      return;
    cancelOpening();
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += azimuth;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + polar,
      controls.minPolarAngle,
      controls.maxPolarAngle,
    );
    camera.position
      .copy(controls.target)
      .add(offset.setFromSpherical(spherical));
    controls.update();
    controls.enableDamping = damping;
    requestRender();
  }

  function reset() {
    if (disposed || !ready) return;
    cancelOpening();
    engineOpen = false;
    hoodAmount = 0;
    hoodPivot.rotation.z = 0;
    bounds.copy(closedBounds);
    progress = 0;
    targetTurn = 0;
    car.rotation.y = 0;
    // Flush residual pointer damping before restoring the saved home camera.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.reset();
    fitCamera(HOME_DIRECTION);
    controls.enableDamping = damping;
    // Reset the view only; preserve selected paint and atmosphere preference.
    settled = true;
    emitState();
    requestRender();
  }

  function onVisibilityChange() {
    if (document.hidden) stopRendering();
    else requestRender();
  }

  function onMotionChange(event) {
    reducedMotion = event.matches;
    controls.enableDamping = !reducedMotion;
    targetTurn = reducedMotion || engineOpen ? 0 : -progress * 0.42;
    if (reducedMotion && car) {
      car.rotation.y = 0;
      if (opening) setEngineOpen(true);
    }
    emitState();
    requestRender();
  }

  function cancelOpening() {
    introActive = false;
    opening = false;
    viewTransition = null;
    car.position.y = 0;
    emitState();
  }

  function onDragStart() {
    cancelOpening();
    dragging = true;
    canvas.style.cursor = "grabbing";
    requestRender();
  }

  function onDragEnd() {
    dragging = false;
    canvas.style.cursor = "grab";
    requestRender();
  }

  function hitsBonnet(clientX, clientY) {
    if (!ready || disposed || contextLost || !hoodPivot) return false;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    car.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(pointerNdc, camera);
    // Use the nearest real body surface, not a bounding box. Roof/glass/body clicks
    // must never activate a bonnet hidden behind them after the car is rotated.
    const hit = raycaster.intersectObjects(pickableMeshes, false)[0];
    return Boolean(hit && bonnetMeshes.has(hit.object));
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !ready) return;
    activePointers.add(event.pointerId);
    if (activePointers.size !== 1 || !event.isPrimary) {
      tapCandidate = null;
      return;
    }
    tapCandidate = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      moved: false,
      bonnet: hitsBonnet(event.clientX, event.clientY),
      tolerance: event.pointerType === "touch" ? 10 : 6,
    };
  }

  function onPointerMove(event) {
    if (tapCandidate?.pointerId === event.pointerId) {
      if (
        Math.hypot(
          event.clientX - tapCandidate.x,
          event.clientY - tapCandidate.y,
        ) > tapCandidate.tolerance
      )
        tapCandidate.moved = true;
    } else if (!activePointers.size && event.pointerType !== "touch") {
      canvas.style.cursor = hitsBonnet(event.clientX, event.clientY)
        ? "pointer"
        : "grab";
    }
  }

  function onPointerUp(event) {
    const tap = tapCandidate;
    const activate =
      tap?.pointerId === event.pointerId &&
      activePointers.size === 1 &&
      !tap.moved &&
      tap.bonnet &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <=
        tap.tolerance &&
      performance.now() - tap.time < 650 &&
      hitsBonnet(event.clientX, event.clientY);
    activePointers.delete(event.pointerId);
    tapCandidate = null;
    if (activate) {
      canvas.focus({ preventScroll: true });
      setEngineOpen(!engineOpen);
    }
  }

  function onPointerCancel(event) {
    activePointers.delete(event.pointerId);
    tapCandidate = null;
  }

  function onPointerLeave() {
    if (!activePointers.size) canvas.style.cursor = "grab";
  }

  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stopRendering();
    onError?.(
      new Error(
        "The 3D graphics context was interrupted. Please reload if it does not recover.",
      ),
    );
  }

  function onContextRestored() {
    contextLost = false;
    requestRender();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(loadTimer);
    abortController.abort();
    stopRendering();
    resizeObserver?.disconnect();
    visibilityObserver?.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    motionQuery.removeEventListener("change", onMotionChange);
    canvas?.removeEventListener?.("webglcontextlost", onContextLost);
    canvas?.removeEventListener?.("webglcontextrestored", onContextRestored);
    controls?.removeEventListener("change", requestRender);
    controls?.removeEventListener("start", onDragStart);
    controls?.removeEventListener("end", onDragEnd);
    controls?.dispose();
    canvas?.removeEventListener?.("pointerdown", onPointerDown, true);
    canvas?.removeEventListener?.("pointermove", onPointerMove);
    canvas?.removeEventListener?.("pointerup", onPointerUp, true);
    canvas?.removeEventListener?.("pointercancel", onPointerCancel);
    canvas?.removeEventListener?.("lostpointercapture", onPointerCancel);
    canvas?.removeEventListener?.("pointerleave", onPointerLeave);
    activePointers.clear();
    bonnetMeshes.clear();
    pickableMeshes.length = 0;
    tapCandidate = null;
    atmosphere?.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) {
      texture.dispose();
      texture.source?.data?.close?.();
    }
    environment?.dispose();
    car?.clear();
    scene?.clear();
    geometries.clear();
    materials.clear();
    textures.clear();
    paintMaterials.clear();
    renderer?.dispose();
    if (canvas?.style) {
      canvas.style.touchAction = originalTouchAction;
      canvas.style.cursor = originalCursor;
    }
  }

  const api = {
    setProgress,
    setColor,
    rotate,
    reset,
    resize,
    dispose,
    setEngineOpen,
    setEffects,
    playIntro,
  };

  try {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("initCarScene requires an HTML canvas element.");
    }
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = false;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    camera.position.copy(HOME_DIRECTION).multiplyScalar(10);
    car = new THREE.Group();
    scene.add(car);

    // The environment is only reflected in the materials: no floor, backdrop,
    // gradient, or cast shadow. The website's plaster remains visible through alpha.
    const studio = new RoomEnvironment();
    addReflectionCards(studio);
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(studio, 0.02);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.8;
    studio.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xfffcf3, 0x77796c, 1.35));
    const key = new THREE.DirectionalLight(0xfffaf0, 2.6);
    key.position.set(3, 7, -5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xeaf0f4, 1.2);
    fill.position.set(-4, 3, 5);
    scene.add(fill);

    controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.55;
    controls.minPolarAngle = Math.PI * 0.27;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: null,
      RIGHT: null,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: null };
    // OrbitControls defaults to touch-action:none; allow vertical page scrolling.
    canvas.style.touchAction = "pan-y";
    canvas.style.cursor = "grab";
    controls.addEventListener("change", requestRender);
    controls.addEventListener("start", onDragStart);
    controls.addEventListener("end", onDragEnd);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loadTimer = setTimeout(() => abortController.abort(), 30000);
    const response = await fetch(MODEL_URL, { signal: abortController.signal });
    if (!response.ok)
      throw new Error(
        `The BMW model could not be loaded (HTTP ${response.status}).`,
      );
    const data = await response.arrayBuffer();
    clearTimeout(loadTimer);
    const gltf = await loader.parseAsync(data, "");
    const model = gltf.scene;
    model.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of [object.material].flat())
        rememberMaterial(material);
    });

    // Remove the source's unused export helper, not any visible car components.
    model.getObjectByName("M4xNME_unused")?.removeFromParent();
    model.updateMatrixWorld(true);
    const sourceBounds = new THREE.Box3().setFromObject(model);
    // This particular asset has a few disconnected splitter triangles over its roof.
    // Keep the real front splitter, identified by exact node, below the hood line.
    const splitter = model.getObjectByName(
      "M4xNME_splitter_F_csl_M4xNME_Carbon1001_0",
    );
    if (splitter?.isMesh) {
      removeStraySplitterTriangles(
        splitter,
        sourceBounds.min.y + 1.05,
        geometries,
      );
    }
    model.updateMatrixWorld(true);
    sourceBounds.setFromObject(model);
    const center = sourceBounds.getCenter(new THREE.Vector3());
    const hood = model.getObjectByName("M4xNME_hood_csl");
    const hoodCenter = new THREE.Box3()
      .setFromObject(hood || model)
      .getCenter(new THREE.Vector3());
    const oriented = new THREE.Group();
    oriented.add(model);
    model.position.sub(
      new THREE.Vector3(center.x, sourceBounds.min.y, center.z),
    );
    oriented.rotation.y = hoodCenter.z > center.z ? Math.PI / 2 : -Math.PI / 2;
    car.add(oriented);
    car.updateMatrixWorld(true);
    const size = new THREE.Box3()
      .setFromObject(car)
      .getSize(new THREE.Vector3());
    if (!Number.isFinite(size.x) || size.x <= 0)
      throw new Error("The BMW model has no usable geometry.");
    car.scale.setScalar(4.8 / size.x);

    const paint = createMetallicPaint(DEFAULT_PAINT);
    rememberMaterial(paint);
    paintMaterials.add(paint);
    const windowGlass = new THREE.MeshPhysicalMaterial({
      name: "Smoked automotive glazing",
      color: "#28332f",
      metalness: 0.22,
      roughness: 0.13,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      envMapIntensity: 0.95,
      side: THREE.FrontSide,
    });
    rememberMaterial(windowGlass);
    const headlampGlass = new THREE.MeshPhysicalMaterial({
      name: "Clear headlamp lenses",
      color: "#d9e2de",
      metalness: 0.05,
      roughness: 0.08,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    rememberMaterial(headlampGlass);
    const engineMetal = new THREE.MeshStandardMaterial({
      name: "Graphite engine casting",
      color: "#2b3032",
      metalness: 0.65,
      roughness: 0.38,
      side: THREE.DoubleSide,
    });
    const engineBay = new THREE.MeshStandardMaterial({
      name: "Matte engine-bay components",
      color: "#181d1c",
      metalness: 0.18,
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
    const engineBrace = new THREE.MeshStandardMaterial({
      name: "Brushed aluminium strut brace",
      color: "#9aa29a",
      metalness: 0.85,
      roughness: 0.28,
      side: THREE.DoubleSide,
    });
    [engineMetal, engineBay, engineBrace].forEach(rememberMaterial);
    const treated = new Set();
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      const tuneMaterial = (material) => {
        const name = material.name;
        // Exact match is intentional: Paint2 is the original red CSL detailing.
        if (name === "M4xNME_Paint") return paint;
        if (name === "M4xNME_GlassClear") {
          if (/windshield|sideglass|doorglass|backlight/i.test(object.name)) {
            object.renderOrder = 2;
            return windowGlass;
          }
          if (/headlightglass/i.test(object.name)) return headlampGlass;
        }
        if (/^M4xNME_Engine/.test(name)) {
          if (/strutbrace/.test(object.name)) return engineBrace;
          if (/^M4xNME_engine_|intake/.test(object.name)) return engineMetal;
          return engineBay;
        }
        if (treated.has(material)) return material;
        treated.add(material);
        if (material.emissive && !/hud|screen/i.test(name))
          material.emissive.set(0x000000);
        if (/^Scene_-_Root/.test(name)) {
          material.color.set("#1b1d1b");
          material.metalness = 0;
          material.roughness = 0.91;
        } else if (/^M4xNME_mechanical/.test(name)) {
          material.color.set("#303735");
          material.metalness = 0.6;
          material.roughness = 0.52;
        } else if (/^M4xNME_silver/.test(name)) {
          material.color.set("#a5a9a5");
          material.metalness = 0.85;
          material.roughness = 0.25;
        } else if (/^M4xNME_Carbon/.test(name)) {
          material.color.set("#252a27");
          material.metalness = 0.3;
          material.roughness = 0.38;
        } else if (/^M4xNME_Black/.test(name)) {
          material.color.set("#202421");
          material.metalness = 0.15;
          material.roughness = 0.4;
        } else if (/^M4xNME_(runningY|highbeam)/.test(name)) {
          material.color.set("#e8eddb");
          material.emissive.set("#e6ecd3");
          material.emissiveIntensity = 3.5;
          headlightMaterials.add(material);
          material.metalness = 0.1;
          material.roughness = 0.22;
        }
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(tuneMaterial)
        : tuneMaterial(object.material);
    });

    car.updateMatrixWorld(true);
    bounds.setFromObject(car);
    closedBounds.copy(bounds);
    const hoodBox = new THREE.Box3().setFromObject(hood);
    hoodPivot = new THREE.Group();
    hoodPivot.name = "Animated bonnet hinge";
    hoodPivot.position.copy(
      car.worldToLocal(
        new THREE.Vector3(
          hoodBox.min.x,
          hoodBox.max.y - 0.03,
          (hoodBox.min.z + hoodBox.max.z) / 2,
        ),
      ),
    );
    car.add(hoodPivot);
    hoodPivot.attach(hood);
    hood.traverse((object) => {
      if (object.isMesh) bonnetMeshes.add(object);
    });
    car.traverse((object) => {
      if (object.isMesh) pickableMeshes.push(object);
    });
    canvas.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp, true);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("lostpointercapture", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    const engine = model.getObjectByName("M4xNME_engine");
    engineTarget = new THREE.Box3()
      .setFromObject(engine)
      .getCenter(new THREE.Vector3());
    engineTarget.x *= 0.32;
    engineTarget.y = (closedBounds.max.y + closedBounds.min.y) * 0.5 + 0.18;
    const lampPositions = [
      "M4xNME_headlight_L_yellow_M4xNME_runningY_0",
      "M4xNME_headlight_R_yellow_M4xNME_runningY_0",
    ].map((name) => {
      const box = new THREE.Box3().setFromObject(model.getObjectByName(name));
      const position = box.getCenter(new THREE.Vector3());
      position.x += 0.025;
      return car.worldToLocal(position);
    });
    const tailBox = new THREE.Box3().setFromObject(
      model.getObjectByName("M4xNME_exhaust_double_straight"),
    );
    const exhausts = [-0.3, 0.3].map((z) =>
      car.worldToLocal(
        new THREE.Vector3(
          tailBox.min.x - 0.05,
          tailBox.getCenter(new THREE.Vector3()).y,
          z,
        ),
      ),
    );
    atmosphere = createSceneEffects({
      parent: car,
      headlights: lampPositions,
      exhausts,
      forward: new THREE.Vector3(1, 0, 0),
    });
    controls.target.set(0, (bounds.max.y + bounds.min.y) * 0.5, 0);
    resize();
    fitCamera(HOME_DIRECTION);
    controls.saveState();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery.addEventListener("change", onMotionChange);
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    }
    if ("IntersectionObserver" in window) {
      const rect = canvas.getBoundingClientRect();
      inView =
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth;
      visibilityObserver = new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        if (inView) requestRender();
        else stopRendering();
      });
      visibilityObserver.observe(canvas);
    }
    // Compile before telling the UI it can remove its loading state.
    await renderer.compileAsync(scene, camera);
    ready = true;
    requestRender();
  } catch (cause) {
    dispose();
    const error =
      cause?.name === "AbortError"
        ? new Error(
            "The BMW model took too long to download. Please check your connection and retry.",
            { cause },
          )
        : cause instanceof Error
          ? cause
          : new Error("The 3D viewer could not start.", { cause });
    onError?.(error);
    throw error;
  }

  onReady?.(api);
  return api;
}

/** Clip only the known stray portion without changing the original asset on disk. */
function removeStraySplitterTriangles(mesh, maximumWorldY, geometries) {
  const source = mesh.geometry;
  const position = source.getAttribute("position");
  const index = source.getIndex();
  const count = index ? index.count : position.count;
  const point = new THREE.Vector3();
  const kept = [];
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((offset) =>
      index ? index.getX(i + offset) : i + offset,
    );
    const below = triangle.every((vertex) => {
      point
        .fromBufferAttribute(position, vertex)
        .applyMatrix4(mesh.matrixWorld);
      return point.y < maximumWorldY;
    });
    if (below) kept.push(...triangle);
  }
  if (kept.length === count) return;
  const cleaned = source.clone();
  cleaned.setIndex(kept);
  // Bounding-box computation normally includes unreferenced vertices. Exclude them.
  cleaned.boundingBox = new THREE.Box3();
  for (const vertex of kept)
    cleaned.boundingBox.expandByPoint(
      point.fromBufferAttribute(position, vertex),
    );
  cleaned.boundingSphere = cleaned.boundingBox.getBoundingSphere(
    new THREE.Sphere(),
  );
  geometries.add(cleaned);
  mesh.geometry = cleaned;
}
