# RenderRank

**Cross-platform 3D rendering GPU benchmarks in the browser.**

RenderRank runs WebGPU rendering tests in the browser. Select a scene, choose a resolution, preview it, or run its benchmark and save the full run report as JSON to open again later. Sponza runs a light-count sweep; the procedural Orrery plays a fixed 40-second camera path. You can sign in with Google. Saved history for signed-in users, ranked scores, and a public leaderboard are planned.

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

1. **Choose a scene.** The library lists the Orrery and Sponza. Each card opens that scene's setup screen.
2. **Set up, then preview or benchmark.** Pick 1080p, 1440p, or 2160p. A live frame-time graph sits beside the FPS readout, with dashed lines at 8.3, 16.7, and 33.3 ms (120, 60, and 30 FPS); use Back to stop.
   - **Sponza:** preview has a free camera and 1–5,000 point lights. The benchmark sweeps 500–5,000 lights in 500-light steps, with 30 warm-up and 120 measured frames each.
   - **Orrery:** it plays a fixed 40-second camera path. Preview loops it, and the benchmark plays it once without a frame-rate cap. The **stress test** plays it back to back, 20 times by default (set 2–100 in Loops), and reports frame-rate stability: the lowest loop score as a percentage of the highest. 97% or more passes. Twenty loops take about 13 minutes.
3. **Review the results.** The results screen shows the Orrery's score (or a stress test's stability), a frame-time graph of the whole run, a per-light-count, per-shot, or per-loop table, and the full run report: device, browser, display, WebGPU adapter, workload constants, features, limits, and the exact JSON. **Export JSON** downloads that report exactly as printed, and **Upload score** saves it on the server unchanged. Results last until the page is reloaded, but **Open report** on the library screen (or dropping the file there) shows a saved report again, looking exactly as it did when the run finished. It also opens files from the server's `results/` folder.

Sponza's benchmark measures display-paced frame intervals, which are capped by the refresh rate, so it has no score. The Orrery's score is 100 × the harmonic mean of its four shots' frame rates. It isn't ranked against other devices yet, and it compares only at the same resolution. Keep the tab visible during a run: a hidden tab invalidates the score.

*Stretch goal:* a diffusion image-generation benchmark.

## Technical approach

1. **Clustered lighting.** A GPU compute pass assigns lights to 3D view-space clusters, then shading uses each cluster's light list.
2. **Browser-based.** There's no software to download and no environment to set up. A benchmark starts with one click.
3. **Repeatable measurement (partly in place).** The Orrery fixes its camera path, animation, and resolution. Repeating runs, reporting variation, and versioning the workload are planned.
4. **Comparable results (partly in place).** The Orrery's benchmark measures completed-work throughput offscreen, separately from display FPS. It reports GPU timestamps alongside, as diagnostics only. Sponza is still display-paced.

## Who it's for

- **Device owners** can compare hardware they already own and see which rendering features affect performance.
- **Web developers** can explore rendering bottlenecks on varied devices and choose suitable quality settings.
- **3D artists** can use interactive scenes to check how a 3D scene performs on a GPU, without writing code.

**Responsible design:** device details are read from browser APIs. Uploading is opt-in per run. An upload stores the run and the browser-reported device details on the RenderRank server, but no IP address, language, or time zone. Signing in is optional.

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

The second scene, the **Orrery**, has no meshes or textures. Its geometry is a signed distance function ray-marched in one fragment shader (`src/shaders/orrery.fs.wgsl`), with soft shadows from two lights, ambient occlusion, one reflection bounce, and a shadowed volumetric sun shaft. Its camera and mechanism follow a fixed timeline (`src/procedural/orrery_timeline.ts`). Its benchmark renders offscreen without a frame-rate cap and reports a score: 100 × the harmonic mean of the four shots' frame rates. Uploaded runs, all in Chrome at 1080p unless noted:

| Device | Score |
| --- | --- |
| RTX 5080 | 17,785 (178 FPS); 4,675 and 5,051 at 2160p |
| Apple M5 Max | 6,825 |
| iPhone | 1,152 |

The two 2160p runs on the same machine differ by 8%, so repeatability still needs work. See the [implementation plan](doc/implementation_plan.md#21-measured-so-far).

The app has three screens: the simulation library, a setup screen per scene (resolution, preview, run), and a results screen with the score, a frame-time graph of the whole run, a per-segment table, the full run report, **Export JSON**, and **Upload score**. The library can open a saved report. Upload saves the run and everything the browser reveals about the device (GPU, OS, browser, CPU threads, memory bucket, screen, WebGPU features and limits) as a JSON file under `results/` on the machine running the dev server; that directory is gitignored. No IP address, language, or time zone is stored.

Optional **Sign in with Google** runs entirely in the browser ([doc/auth.md](doc/auth.md)). Uploads don't carry the account yet.

Sponza's light-sweep runner lives in `src/testing/benchmark.ts`, and the Orrery's throughput loop in `src/procedural/orrery_session.ts`. Still to be built:

- repeats and variance reporting;
- a versioned workload;
- a production backend that validates uploads and keeps history;
- the leaderboard.

Scene registration instructions and current loader limitations are in [AGENTS.md](AGENTS.md). The scene catalog is `src/simulations.ts`.

## Getting started

Requirements: Node.js 20.19+ or 22.12+ (required by Vite 7) and a browser with WebGPU enabled, such as a recent Chrome or Edge.

```bash
npm install
npm run dev     # Vite dev server on http://127.0.0.1:5174
npm run build   # production build to dist/ (the scenes/ folder is copied in too)
```

Sign in with Google is off unless `VITE_GOOGLE_CLIENT_ID` is set (see `.env.example`). To sign in locally, put it in `.env.local`, restart `npm run dev` (it reads the variable only at startup), and open `http://127.0.0.1:5174/`. That address must be one of the client's authorized origins. Creating the client ID is described in [doc/auth.md](doc/auth.md).

**Upload score** works only when the page is served by `npm run dev` or `vite preview`. Their middleware ([scripts/results-api.ts](scripts/results-api.ts)) writes each upload to `results/<timestamp>-<scene>-<id>.json`, and that directory is gitignored. The dev server refuses to serve `results/` (`server.fs.deny` in `vite.config.ts`), so uploads aren't readable over the web. A static build, such as GitHub Pages, has no upload endpoint, and the page says so.

The root URL opens the scene library. Scene assets and the renderer load only when Preview or Run benchmark is selected. The device panel shows the GPU model, OS, browser version, and logical core count when the browser exposes them.

To run the browser checks:

```bash
npx playwright install chromium
npm run test:browser
```

Tests start or reuse a local server on port 5175 and require WebGPU. Sign-in tests use a fake Google script (`tests/fake-google.ts`) and never contact Google. Set `PREVIEW_URL` to test another running server. `npm run build` also checks TypeScript and copies scene assets using the portable Node script in `scripts/`.

Merging into `main` triggers the GitHub Pages deployment. The deployed root also opens the scene library; asset paths support the configured Vite base URL.

## Repository layout

```
src/
  main.ts           library, scene setup, and results screens; viewer; JSON export, opening a saved report, upload
  report_file.ts    reads a saved run report back from a file
  auth.ts           Sign in with Google (Google Identity Services)
  report.ts         the run report shown on the results screen and sent by Upload score
  ui/               frame-time sparkline, results chart, and run-report view
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
scripts/            portable scene-asset copying; results upload endpoint (dev/preview server)
tests/              Playwright UI and WebGPU integration checks; fake Google sign-in script
doc/                kickoff presentation, implementation plan, Google sign-in setup
results/            uploaded runs as JSON (created on first upload, gitignored)
```

## Documents

- [Kickoff presentation](doc/kickoff_presentation.pdf)
- [Implementation plan and current status](doc/implementation_plan.md)
- [Sign in with Google: how it works and setup](doc/auth.md)
- [Scene registration and contributor instructions](AGENTS.md)
- [Preview image source and credits](img/README.md)
