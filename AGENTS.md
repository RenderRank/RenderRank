# Working in RenderRank

## Branches and product constraints

- Never push to `main` without the user's explicit permission. Keep frontend work on a feature branch.
- The root URL must open the simulation library. Load the renderer and scene assets only after Preview or Run benchmark is selected.
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

## Loader and lighting limitations

Registering a URL does not guarantee that an arbitrary glTF will render correctly. Inspect these assumptions before introducing a different asset:

- `src/stage/scene.ts` currently expects indexed triangle meshes with positions, normals, UVs, materials, and suitable texture/sampler data. Tangents are optional. It does not implement animation, skinning, or full glTF extension support. The source file documents additional assumptions.
- The renderer supports metallic-roughness PBR and normal maps. Alpha blending is treated as cutout in the deferred G-buffer; scenes requiring true transparency need renderer work.
- Point-light movement is defined in `src/shaders/move_lights.cs.wgsl` and is currently sized/positioned for Sponza. New geometry may need a scene-specific light volume or effect configuration. Add explicit catalog settings and wire them through the runtime instead of silently changing Sponza's workload globally.
- The common camera projection is defined by `src/renderer.ts` and `src/stage/camera.ts`. Assets with very different dimensions may need explicit projection settings.
- The current benchmark sweeps 500 to 5,000 lights, with 30 warmup frames and 120 measured frames per configuration. It measures display-paced frame intervals, not uncapped GPU throughput. Do not label the output as a ranked score.
- Browser device details may be hidden or reduced. `src/device.ts` uses reported WebGPU/WebGL information and reports unavailable fields honestly; do not infer a precise GPU model from core count or OS.

## Files to know

- `src/simulations.ts`: scene metadata, source URLs, starting cameras, render resolutions.
- `src/main.ts`: simulation library, selection, settings, modal viewer, results, CSV export.
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

The tests cover the root landing page, lazy scene loading, settings, mobile overflow, unsupported browsers, renderer reopen/resolution changes, benchmark cancellation, and CSV export. When adding scenes, update the current one-scene count assertion and add coverage that selects and actually renders each scene. Check browser console output for missing assets, shader validation errors, and lost devices.

The current GitHub Pages workflow deploys on `main` pushes. Keep asset URLs relative to `import.meta.env.BASE_URL` so project-path hosting works. Do not deploy or push to `main` merely to verify a scene.
