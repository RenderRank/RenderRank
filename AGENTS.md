# Working in RenderRank

## Branches and product constraints

- Never push to `main` without the user's explicit permission. Keep frontend work on a feature branch.
- The root URL must open the simulation library. Load the renderer and scene assets only after Preview or Run benchmark is selected.
- The app has three screens chosen by the URL hash: `#/` (library), `#/scene/<id>` (setup, preview, run), and `#/results` (last run). Keep each screen to its one job.
- Visitors who don't sign in must not contact Google's sign-in service. `src/auth.ts` loads Google's script only when Sign in is clicked.
- Keep the UI minimal: real scenes, real device information, functional controls, no placeholder scenes or invented scores.
- Respect existing changes and untracked assets in the working tree.

## Registering a new scene

The scene catalog lives in `src/simulations.ts`. The landing-page cards, scene navigation, available count, selection state, viewer title, and run settings use this catalog. Do not add a second hardcoded entry in `src/main.ts`.

1. Put the glTF and all referenced buffers/textures in `scenes/<scene-id>/`. Preserve relative paths and filename case. The build copies the entire `scenes/` directory to `dist/`.
2. Add a real preview image to `img/` and import it in `src/simulations.ts`. Vite fingerprints imported previews for deployment.
3. Append a `Simulation` entry to `simulations`, with a unique, stable ID and a useful starting camera. For example:

   ```ts
   import courtyardPreview from '../img/courtyard-preview.jpg';

   // Inside the simulations array:
   {
       id: 'courtyard',
       name: 'Courtyard',
       category: 'Outdoor scene',
       summary: 'A brief, factual description of the workload.',
       description: 'What geometry, materials, or lighting this scene tests.',
       preview: courtyardPreview,
       previewAlt: 'Describe the scene shown in the preview.',
       source: `${import.meta.env.BASE_URL}scenes/courtyard/Courtyard.gltf`,
       camera: { position: [0, 2, -5], yaw: 90, pitch: 0 },
   }
   ```

4. Verify the starting camera in Preview. Coordinates are in the scene's world space; yaw/pitch are degrees. `src/simulation.ts` restores this camera at the start of each preview/run. Check scale, clipping, and lighting rather than copying Sponza's coordinates.
5. Test switching between the new scene and Sponza after previewing and benchmarking. Selection disposes the previous GPU session; `src/simulation.ts` creates the selected scene with its catalog URL. Keep this behavior when adding new renderer types.

## Procedural scenes

A catalog entry with `kind: 'procedural'` has no glTF source or free camera. `src/simulation.ts` hands it to its own session (`src/procedural/orrery_session.ts`), which drives a fixed camera timeline instead of the light sweep.

- The Orrery's geometry and materials live in `src/shaders/orrery.fs.wgsl`; camera shots and mechanism animation live in `src/procedural/orrery_timeline.ts`. Ring radii and the orrery center appear in both and must match.
- The `orrery*` step caps in `src/shaders/shaders.ts` set the per-pixel cost. Changing them, the shader, or the timeline changes the workload, so earlier results stop being comparable.
- Keep the camera path clear of geometry: a camera inside a surface renders garbage. Orbiting planets sit at radii 5.2–7.0.
- Its benchmark runs a throughput loop (`runThroughput` in `orrery_session.ts`): frames render offscreen back to back, at most two in flight, and the canvas gets a copy only when the display asks. It reports frame times per shot, the ray-march pass's GPU time when timestamp queries are available, and a score (100 × the harmonic mean of the shots' frame rates). A run is marked not valid if the tab was hidden. Preview stays display-paced.
- The stress test is the same throughput loop run back to back (`loops` > 1), after one warm-up and with no pause between loops. Each loop gets a score; stability is the lowest loop score divided by the highest, and `stabilityPassMark` in `src/simulations.ts` sets the pass mark. The catalog's `stress` entry enables it for a scene and sets the default loop count; the page accepts `stressLoopRange`. Offer it only for benchmarks that measure uncapped throughput: a display-paced one always looks stable. Its frame-time graph keeps one point per quarter second (`main.ts`) so a long run's report fits the upload size cap.
- Scores compare only at the same resolution and workload. There is no leaderboard yet, so don't call them ranked.

## Loader and lighting limitations

Registering a URL does not guarantee that an arbitrary glTF will render correctly. Inspect these assumptions before introducing a different asset:

- `src/stage/scene.ts` currently expects indexed triangle meshes with positions, normals, UVs, materials, and suitable texture/sampler data. Tangents are optional. It does not implement animation, skinning, or full glTF extension support. The source file documents additional assumptions.
- The renderer supports metallic-roughness PBR and normal maps. Alpha blending is treated as cutout in the deferred G-buffer; scenes requiring true transparency need renderer work.
- Point-light movement is defined in `src/shaders/move_lights.cs.wgsl` and is currently sized/positioned for Sponza. New geometry may need a scene-specific light volume or effect configuration. Add explicit catalog settings and wire them through the runtime instead of silently changing Sponza's workload globally.
- The common camera projection is defined by `src/renderer.ts` and `src/stage/camera.ts`. Assets with very different dimensions may need explicit projection settings.
- The current benchmark sweeps 500 to 5,000 lights, with 30 warmup frames and 120 measured frames per configuration. It measures display-paced frame intervals, not uncapped GPU throughput, so Sponza has no score. Do not label its output as a score.
- Browser device details may be hidden or reduced. `src/device.ts` uses reported WebGPU/WebGL information and reports unavailable fields honestly; do not infer a precise GPU model from core count or OS.

## Files to know

- `src/simulations.ts`: scene metadata, source URLs, starting cameras, render resolutions, and each scene's UI text.
- `src/procedural/`, `src/renderers/orrery.ts`, `src/shaders/orrery.fs.wgsl`: the procedural Orrery scene.
- `src/main.ts`: the three screens, hash routing, modal viewer, results, JSON export, opening a saved report, result upload, account controls.
- `src/auth.ts`: Sign in with Google (Google Identity Services, in the browser). Configured by `VITE_GOOGLE_CLIENT_ID` at build time; without it, accounts are off. The stored ID token isn't verified by the page; any future API must verify it. See `doc/auth.md`.
- `tests/fake-google.ts`: a fake Google Identity Services script for browser tests.
- `src/ui/frame_chart.ts`: the live frame-time sparkline and the results chart.
- `src/report.ts`, `src/ui/report_view.ts`: the run report. It is built once at the end of a run, shown in full on the results screen, saved by Export JSON, and uploaded unchanged. The results screen is drawn from the report alone, so a report opened from a file (`src/report_file.ts` validates it) looks exactly as it did when the run finished. Add new fields to the report, not to the upload request or the screen. A change to the report's shape needs a new `schemaVersion` and a reader for the old one, or saved reports stop opening.
- `scripts/results-api.ts`: dev/preview-server endpoint (`POST /api/results`) that saves uploaded results to `results/` (gitignored). It is exposed to the internet through the dev server, so keep its size cap, rate limit, file limit, and server-chosen file names, and keep `results/` in `server.fs.deny` in `vite.config.ts` so saved files aren't served. Static hosting has no such endpoint; the page reports that upload is unavailable.
- `src/simulation.ts`: lazy GPU session, scene loading, renderer lifecycle, preview and benchmark integration.
- `style.css`: responsive UI; preserve keyboard focus styles and reduced-motion support.
- `src/testing/benchmark.ts`: benchmark protocol, progress callbacks, abort handling, restoration of light settings.
- `src/gpu/context.ts`: device ownership, adapter metadata, canvas resizing and disposal.

## Verification and local preview

```sh
npm install
npm run build
npx playwright install chromium
npm run dev -- --port 5175
npm run test:browser
```

The Vite default port is 5174. Browser tests start or reuse a server on 5175 so an existing dev session can remain undisturbed. Set `PREVIEW_URL` to test another running server. Browser tests require WebGPU; Linux/CI may require a supported GPU or a software WebGPU adapter. Browser installation/launch may need sandbox approval.

`npm run build` runs TypeScript validation, Vite, then `scripts/copy-scenes.mjs`. Preserve the explicit `dist/scenes/` destination; shell `cp` handles trailing slashes differently on macOS and Linux.

The tests cover the library, scene setup screens, lazy scene loading, settings, mobile overflow, unsupported browsers, renderer reopen/resolution changes, both benchmarks (including cancellation, results, score, and chart), the stress test setup and a stress report's results, JSON export and reopening the saved file, upload (mocked with `page.route`, so tests never write to `results/`), and Google sign-in (fake script, never contacts Google). When adding scenes, update the scene count assertion and add coverage that selects and actually renders each scene. Check browser console output for missing assets, shader validation errors, and lost devices.

The current GitHub Pages workflow deploys on `main` pushes. Keep asset URLs relative to `import.meta.env.BASE_URL` so project-path hosting works. Do not deploy or push to `main` merely to verify a scene.
