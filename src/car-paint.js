import * as THREE from "three";

/** Gloss-coated metallic bodywork; shared by all body panels, including the bonnet. */
export function createMetallicPaint(color) {
  return new THREE.MeshPhysicalMaterial({
    name: "Polished metallic body paint",
    color,
    metalness: 0.9,
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.5,
    side: THREE.DoubleSide,
  });
}

/** Reflected studio strips, never visible as objects in the actual car scene. */
export function addReflectionCards(studio) {
  const strips = [
    { size: [5, 0.12, 0.8], position: [-1, 3.8, 0], intensity: 5 },
    { size: [0.7, 4, 0.12], position: [3.5, 1.5, -2.5], intensity: 3 },
  ];
  for (const strip of strips) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(...strip.size),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setScalar(strip.intensity),
      }),
    );
    panel.name = "Metallic-paint reflection strip";
    panel.position.set(...strip.position);
    studio.add(panel);
  }
  // RoomEnvironment.dispose() owns and releases these meshes after PMREM baking.
}
