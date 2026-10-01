# BMW — The Art of Motion

https://bmw-seven-zeta.vercel.app/

An independent, responsive BMW editorial design study built with Vite, vanilla JavaScript and Three.js. Not an official BMW website.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the URL printed by Vite (normally http://localhost:5173).

```sh
npm run build     # Production files in dist/
npm run preview   # Preview the production build
npm test          # Scroll-math regression tests
npm run test:e2e  # Real-browser checks; requires Google Chrome installed
```

Playwright is configured to use installed Google Chrome with software WebGL for reproducible headless 3D testing. The browser tests start Vite automatically when necessary.

## The experience

- A real, local BMW M4 CSL GLB model with a cinematic arrival, animated bonnet hinge, and the asset's actual engine-bay geometry. The camera lifts to reveal the engine; no generic replacement engine is used.
- **Tap or click the actual bonnet** to open or close it. Nearest-surface raycasting works in either position and after rotation; drags, long presses, cancelled gestures and multitouch are not treated as taps. No bonnet or atmosphere buttons clutter the scene.
- Gloss-coated metallic paint across all finishes, with low roughness, a polished clearcoat and reflected studio strips. Glass, tyres, carbon details and the engine retain their own materials.
- **Replay opening** restarts the entrance. While the car is focused, **Enter / Space** toggles the bonnet and **P** pauses/resumes the lighting and smoke for accessibility.
- Light-red philosophy and FAQ bands, warm-red accents, and the existing Bodoni editorial typography.
- Drag to orbit, use the paint selectors, or reset the camera. Arrow keys explore the scene when the canvas is focused. Drag/keyboard input takes control from the opening animation; reset closes the bonnet while preserving paint and atmosphere preference.
- The viewer renders only while visible. Smoke keeps the visible scene animating; press P while the car is focused to pause the effects and return to on-demand rendering.
- Three scroll chapters: 300svh hero, 320svh bottom-up photographic reveal, and 360svh cumulative specification stage.
- One requestAnimationFrame-throttled page-scroll handler controls CSS custom properties. A single entrance IntersectionObserver animates 166 words and smaller elements; the viewer has its own visibility observer to suspend rendering offscreen.
- A price-free, curated M4 design collection for a portfolio presentation, with official BMW model references and an internal link back to the 3D experience. No shopping, configurator or dealer calls to action.
- Native FAQ disclosures about the design study, accessible mobile navigation and a credits dialog.
- Reduced-motion layouts remove pinning/reveal motion, show the open bonnet immediately, and hide smoke while retaining static lighting. A failed WebGL/model load falls back to a photograph and hides the unavailable 3D controls.
- Local variable Bodoni Moda roman/italic fonts, Caveat Brush, images and 3D model: no runtime asset CDN or API key needed.

## Files

- `index.html`: page content and accessible document structure.
- `src/style.css`: responsive editorial design, sticky chapters and motion preferences.
- `src/main.js`: page interaction, word entrances and scroll orchestration.
- `src/scroll-math.js`: independently tested progress calculations.
- `src/car-scene.js`: Three.js viewer, raycast bonnet interaction, cinematic camera sequence and resource lifecycle.
- `src/car-paint.js`: polished metallic material and reflected studio-light strips.
- `src/scene-effects.js`: deterministic procedural exhaust smoke and headlamp/rim lighting.
- `src/cinematic.css`: engine captions, cinematic controls and arrival effects.
- `tests/`: unit and real-browser behavior checks, including engine opening/replay, lighting/smoke toggles, module cleanup and reduced motion.
- `public/models/ATTRIBUTION.md`: model source, creator, license and modifications.
- `public/fonts/*LICENSE.txt`: font licenses.

## Content and credits

The interactive asset is a BMW **M4 CSL** artistic visualization. The M4 collection is an editorial showcase, not a sales catalogue; Competition specifications are illustrative. Preview paint finishes are artistic, not factory paint codes. Official BMW links are design references. There are no displayed prices, shopping calls to action, booking backend, tracking, payment flow or data collection.

**Model:** “BMW m4 CSL 2023” by Black Snow, CC BY 4.0, optimized by AshishB2000. Full source links and changes: `public/models/ATTRIBUTION.md`. Retain attribution when redistributing.

**Photographs:** downloaded from Unsplash image sources:

- `https://images.unsplash.com/photo-1556189250-72ba954cfc2b` — road/experience scene.
- `https://images.unsplash.com/photo-1555215695-3004980ad54e` — detail/composition scene.

**Type:** Bodoni Moda and Caveat Brush, distributed by Google Fonts under the SIL Open Font License; license text is included alongside the locally hosted font files.

BMW, M and model names remain trademarks of BMW AG. This project is not affiliated with or endorsed by BMW.
