# RenderRank

**Cross-platform 3D rendering GPU benchmarks in the browser.**

RenderRank is a WebGPU benchmark suite that runs entirely in the browser. Pick a scene, adjust its rendering features, run a controlled test, and compare the results across your own devices. With your consent, you can also submit them to a public leaderboard.

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

RenderRank's distinction is adjustable scene features, repeatable presets, and personal result history in a single browser workflow.

## How it works

1. **Choose a scene.** Adjust crowds, lighting, post-processing, and screen-space effects.
2. **Run a controlled test.** Track FPS, frame times, and rendering throughput.
3. **Save and compare.** Review results across your devices, and submit to the public leaderboard only if you choose to.

**Ranked runs** use locked presets so scores stay comparable. **Custom runs** let you explore any combination of settings.

*Stretch goal:* a diffusion image-generation benchmark.

## Technical approach

1. **Clustered lighting.** A GPU compute pass assigns lights to 3D view-space clusters, then shading uses each cluster's light list.
2. **Browser-based.** There's no software to download and no environment to set up. A benchmark starts with one click.
3. **Repeatable measurement.** Each run fixes the scene seed, camera path, resolution, and version. It warms up, repeats the run, and reports the variation.
4. **Comparable results.** Display FPS is reported separately from completed-work throughput. Optional GPU timestamps are treated as diagnostics only.

## Who it's for

- **Device owners** can compare hardware they already own and see which rendering features affect performance.
- **Web developers** can explore rendering bottlenecks on varied devices and choose suitable quality settings.
- **3D artists** can use interactive scenes to check how a 3D scene performs on a GPU, without writing code.

**Responsible design:** sharing is opt-in, device metadata is kept to a minimum, and results are grouped by test version and environment.

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

The codebase starts from a WebGPU renderer (TypeScript + Vite) that draws the Sponza atrium lit by many moving point lights. It has three interchangeable renderers:

- **Naive forward:** every fragment evaluates every light. This is the baseline.
- **Forward+:** a compute pass bins lights into a 3D grid of view-frustum clusters, and the forward pass shades each fragment using only its cluster's lights.
- **Clustered deferred:** the same clustering, but shading runs in a full-screen pass over a G-buffer.

It also has a basic frame-time benchmark runner in `src/testing/benchmark.ts`. The scene controls, fixed-run protocol, result storage, and leaderboard described above are still to be built.

## Getting started

Requirements: Node.js 20.19+ or 22.12+ (required by Vite 7) and a browser with WebGPU enabled, such as a recent Chrome or Edge.

```bash
npm install
npm run dev     # Vite dev server on http://127.0.0.1:5174
npm run build   # production build to dist/ (the scenes/ folder is copied in too)
```

## Repository layout

```
src/
  main.ts           entry point: WebGPU init, scene loading, GUI
  renderer.ts       shared renderer base and WebGPU setup
  renderers/        naive, Forward+, and clustered deferred renderers
  shaders/          WGSL shaders and the constants injected into them
  stage/            camera, lights, and glTF scene loading
  testing/          benchmark runner
scenes/sponza/      Sponza glTF scene and textures
doc/                project documents (kickoff presentation)
```

## Documents

- [Kickoff presentation](doc/kickoff_presentation.pdf)
