# RenderRank

**Cross-platform 3D rendering GPU benchmarks in the browser.**

RenderRank runs WebGPU rendering tests in the browser. Select a scene, choose a resolution, preview it, or run its benchmark and export frame-time results as CSV. Sponza runs a light-count sweep; the procedural Orrery plays a fixed 40-second camera path. Ranked scores, saved history, and a public leaderboard are planned.

**Live build:** [renderrank.tonyxtian.com](https://renderrank.tonyxtian.com)

Requires a WebGPU-compatible browser and GPU.

## Team

| Member | Major (Class of 2027) | Owns |
| --- | --- | --- |
| Charles Jin | CIS | Benchmark runner and metrics |
| Eric Sun | Physics, CIS | Frontend and user experience |
| Michael Ren | AI, EE | API, storage, and leaderboard |
| Stan Chen | CIS, ROBO | Scenes, effects, and user research |
| Yiding Tian | CMPE, CGGT | WebGPU renderer and GPU algorithms |

**Faculty Advisor:** Dr. Stephen H. Lane

## The problem

GPU owners need an easy way to compare their devices on the same configurable rendering workloads. Two things get in the way today:

- **Access friction.** Native benchmark apps have to be installed on every device.
- **Comparison friction.** Different settings or environments can make scores hard to interpret.

## Existing approaches

Existing tools cover parts of this need. RenderRank focuses on configurable WebGPU rendering with a consistent test protocol.

| Approach | What it offers | Gap relative to RenderRank |
| --- | --- | --- |
| 3DMark | Rich native graphics tests, including cross-platform tests | Requires a native app. Platform support varies by test. |
| Basemark Web 3.0 | Browser benchmark with WebGL graphics and broader web tests | Doesn't run any visual benchmarks; it only simulates GPU load. |

The planned suite combines adjustable scene features, repeatable presets, and personal result history in a single browser workflow.

## How it works

1. **Choose a scene.** The landing page lists Sponza and the Orrery. Select 1080p, 1440p, or 2160p.
2. **Preview or benchmark.** Preview supports free-camera movement and 1–5,000 point lights. Benchmark sweeps 500–5,000 lights in 500-light increments; use Back to stop.
3. **Export results.** Review average, minimum, and maximum frame times, then download CSV. Results remain available until the page is reloaded.

The current benchmark measures display-paced frame intervals, which are limited by refresh rate. It does not produce a ranked GPU throughput score. Each light count receives 30 warmup frames and 120 measured frames. Keep the tab visible during a run.

*Stretch goal:* a diffusion image-generation benchmark.

## Technical approach

1. **Clustered lighting.** A GPU compute pass assigns lights to 3D view-space clusters, then shading uses each cluster's light list.
2. **Browser-based.** There's no software to download and no environment to set up. A benchmark starts with one click.
3. **Repeatable measurement (planned).** Fix the scene seed, camera path, resolution, and version; repeat runs and report variation.
4. **Comparable results (planned).** Report completed-work throughput separately from display FPS, with GPU timestamps used only as diagnostics.

## Who it's for

- **Device owners** can compare hardware they already own and see which rendering features affect performance.
- **Web developers** can explore rendering bottlenecks on varied devices and choose suitable quality settings.
- **3D artists** can use interactive scenes to check how a 3D scene performs on a GPU, without writing code.

**Responsible design:** device details are read from browser APIs. The current UI does not upload results; future sharing will be opt-in.

## Milestones (Fall 2026)

| When | Milestone | Goals |
| --- | --- | --- |
| Late Sep | Next milestone | One scene with repeatable runs and CSV export. Demo on two devices. |
| Late Oct | Integrated alpha | Three scene presets, saved history, and a leaderboard prototype. Test supported OS/browser pairs. |
| Early Dec | Semester deliverable | Deploy the rendering suite. Validate repeatability and usability. Publish the methodology and a demo. |

## Division of work

Each teammate owns code and a reviewable deliverable for early December.

| Owner | Implementation responsibility | Deliverable by December |
| --- | --- | --- |
| Charles Jin | Benchmark runner and metrics | Fixed-run protocol and CSV export |
| Eric Sun | Frontend and user experience | Preset controls and live metrics UI |
| Michael Ren | API, storage, and leaderboard | Result schema and save/load endpoint |
| Stan Chen | Scenes, effects, and user research | One configurable scene and 3 user interviews |
| Yiding Tian | WebGPU renderer and GPU algorithms | Standardized test procedure and scene |

Code reviews, device testing, integration, and presentation preparation are shared by the whole team.

## Current state of the code

The codebase starts from a WebGPU renderer (TypeScript + Vite) that draws the Sponza atrium lit by many moving point lights. It uses **clustered deferred** shading: a compute pass bins lights into a 3D grid of view-frustum clusters, and a full-screen pass shades a G-buffer using only each cluster's lights. Materials use metallic-roughness PBR (GGX specular, Lambert diffuse) with normal maps. Frames render offscreen in HDR at a fixed resolution picked in the GUI (1080p, 1440p, or 2160p), go through an ACES tonemap, and are scaled to fit the window.

The original naive and Forward+ renderers were removed because no benchmark test uses them. They're still in git history.

The second scene, the **Orrery**, has no meshes or textures. Its geometry is a signed distance function ray-marched in one fragment shader (`src/shaders/orrery.fs.wgsl`), with soft shadows from two lights, ambient occlusion, one reflection bounce, and a shadowed volumetric sun shaft. Its camera and mechanism follow a fixed timeline (`src/procedural/orrery_timeline.ts`). Its benchmark renders offscreen without a frame-rate cap and reports a score: 100 × the harmonic mean of the four shots' frame rates. On an RTX 5080 in Chrome it scored about 4,600 at 2160p (46 FPS) and about 16,500 at 1080p (165 FPS).

The app has three screens: the simulation library, a setup screen per scene (resolution, preview, run), and a results screen with the score, a frame-time graph of the whole run, a per-segment table, CSV export, and **Upload score**. Upload saves the run and everything the browser reveals about the device (GPU, OS, browser, CPU threads, memory bucket, screen, WebGPU features and limits) as a JSON file under `results/` on the machine running the dev server; that directory is gitignored. No IP address, language, or time zone is stored.

The root page opens a simulation library with both scenes, resolution and preview light controls, a lazy-loaded interactive viewer, device information, benchmark progress, and CSV export. The basic frame-time benchmark runner lives in `src/testing/benchmark.ts`. A fixed-run protocol, persistent result storage, and leaderboard remain to be built.

Scene registration instructions and current loader limitations are in [AGENTS.md](AGENTS.md). The scene catalog is `src/simulations.ts`.

## Getting started

Requirements: Node.js 20.19+ or 22.12+ (required by Vite 7) and a browser with WebGPU enabled, such as a recent Chrome or Edge.

```bash
npm install
npm run dev     # Vite dev server on http://127.0.0.1:5174
npm run build   # production build to dist/ (the scenes/ folder is copied in too)
```

The root URL opens the scene library. Scene assets and the renderer load only when Preview or Run benchmark is selected. The device panel shows the GPU model, OS, browser version, and logical core count when the browser exposes them.

To run the browser checks:

```bash
npx playwright install chromium
npm run test:browser
```

Tests start or reuse a local server on port 5175 and require WebGPU. Set `PREVIEW_URL` to test another running server. `npm run build` also checks TypeScript and copies scene assets using the portable Node script in `scripts/`.

Merging into `main` triggers the GitHub Pages deployment. The deployed root also opens the scene library; asset paths support the configured Vite base URL.

## Repository layout

```
src/
  main.ts           simulation library, controls, viewer, results, and CSV export
  simulations.ts    scene catalog and render resolutions
  simulation.ts     lazy WebGPU session and renderer lifecycle
  device.ts         browser-reported GPU, system, and browser details
  gpu/              GpuContext (adapter, device, canvas, recorded adapter info) and mipmap generation
  renderer.ts       renderer base: encodes frames into offscreen targets at a fixed resolution
  renderers/        clustered deferred renderer (glTF scenes) and the Orrery ray-marcher
  procedural/       the Orrery's camera/animation timeline and its session loop
  passes/           shared passes: tonemap, present (scaled blit to the canvas)
  drivers/          frame loops; DisplayDriver is the rAF-paced one
  shaders/          WGSL shaders and the constants injected into them
  stage/            camera, lights, and glTF scene loading
  testing/          benchmark runner
scenes/sponza/      Sponza glTF scene and textures
scripts/            portable production asset copying
tests/              Playwright UI and WebGPU integration checks
doc/                project documents (kickoff presentation)
```

## Documents

- [Kickoff presentation](doc/kickoff_presentation.pdf)
- [Implementation plan and current status](doc/implementation_plan.md)
- [Scene registration and contributor instructions](AGENTS.md)
- [Preview image source and credits](img/README.md)
