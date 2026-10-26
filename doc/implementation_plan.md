# RenderRank Implementation Plan: a 3DMark for the Web

*Drafted 2026-10-25. Covers the work from now to the early-December semester deliverable, plus a roadmap for later.*

## Summary

RenderRank already has a working WebGPU clustered renderer drawing Sponza with up to 5,000 lights. The product we want is a **benchmark**: fixed tests, a fixed protocol, one score, and a place to compare results. The renderer gives us a good foundation, but the measurement layer, the product shell, and the backend all need to be built.

The plan has four pillars:

1. **Measurement you can trust.** Escape vsync with a throughput loop that renders to offscreen targets. Render at a fixed resolution, follow a fixed timeline and camera path, seed all randomness, warm up, repeat, and report variance. This is the hard, novel part, so it starts first.
2. **A small, real test suite.** Suite *Atrium v1* has two graphics tests (lighting-heavy and geometry/post-heavy) in three tiers (Light, Standard, Extreme), and produces a single Graphics Score.
3. **A 3DMark-style product flow.** Detect the device, recommend a test, run it, show the score and how it compares, save to history, and optionally submit.
4. **A leaderboard that stays clean.** A versioned result schema, server-side recomputation and plausibility checks, opt-in submission, and minimal metadata.

WebGPU reveals little about the hardware, and no browser API reports temperature or clock speed. So [§10](#10-system-telemetry-beyond-webgpu) adds a telemetry layer:

- browser APIs where they exist (Compute Pressure, memory, battery, client hints; mostly Chromium-only),
- signals we measure ourselves (a GPU clock probe and repeat-to-repeat drift),
- opt-in ground truth from the user's own sensor logs.

None of it feeds the score.

The late-October alpha milestone in the README isn't reachable from the current code. This plan moves the **alpha to Fri Nov 13**, freezes the workload on **Wed Nov 25**, and releases on **Fri Dec 4**. See [Schedule](#12-schedule-and-owners).

---

## 1. What "3DMark on the web" means for us

| 3DMark concept | RenderRank equivalent | Dec scope |
| --- | --- | --- |
| Benchmark suite (Time Spy, Steel Nomad…) | **Suite** = a versioned bundle of tests, assets, camera paths, and presets. First suite: *Atrium v1* | ✅ |
| Graphics tests GT1 / GT2 | **GT1 "Lights"** and **GT2 "Crowd"**, both in Sponza | ✅ |
| Fixed render resolution, independent of display | Offscreen render targets at the tier resolution, scaled to the canvas | ✅ |
| Tiers (Night Raid → Time Spy → Extreme) | **Light** (1080p, iGPU/mobile), **Standard** (1440p), **Extreme** (4K) | ✅ |
| Graphics Score | Weighted harmonic mean of per-test FPS × calibration constant | ✅ |
| Custom run (not ranked) | Same tests with user settings, labeled *Custom*, never ranked | ✅ |
| Result screen, online compare | Score, per-test FPS, frame-time chart, "faster than X% of <GPU> results" | ✅ |
| Hall of Fame / search | Leaderboard grouped by GPU model, browser, and OS, using medians | ✅ basic |
| Hardware monitoring (temperature, clocks, timeline charts) | Compute Pressure states, a measured GPU clock probe, repeat drift, and memory and power context. Real temperatures and clocks come from opt-in imported sensor logs ([§10](#10-system-telemetry-beyond-webgpu)). | ✅ partial (log import in spring) |
| Stress test (20 loops, stability %) | Loop GT1, report frame-rate stability = min loop FPS / max loop FPS | Stretch |
| Feature tests (API overhead, ray tracing…) | Draw-call throughput test, compute test, lighting-technique comparison | Spring |
| CPU / physics test | WASM physics in Web Workers | Spring |
| Demo mode | Unscored cinematic playback of the camera paths | Spring |

**Explore mode** stays from the current app: free camera, every toggle, and live display FPS. It serves the "3D artists" and "web developers" audiences from the README, and it's where we author camera paths.

---

## 2. Where the code is today

What we can build on:

- A clustered deferred renderer ([src/renderers/](../src/renderers/)). The original naive and Forward+ renderers were removed because no test uses them; git history has them.
- GPU light clustering ([cluster_bounds.cs.wgsl](../src/shaders/cluster_bounds.cs.wgsl), [light_culling.cs.wgsl](../src/shaders/light_culling.cs.wgsl), [light_assignment.cs.wgsl](../src/shaders/light_assignment.cs.wgsl)) and GPU light animation ([move_lights.cs.wgsl](../src/shaders/move_lights.cs.wgsl)).
- A glTF loader and scene graph ([scene.ts](../src/stage/scene.ts)), Sponza (262k triangles, 103 primitives, 25 materials, 69 textures, 51 MB on disk).
- A light-count sweep benchmark with CSV export ([benchmark.ts](../src/testing/benchmark.ts)).
- Vite build plus a GitHub Pages workflow.

The gaps that matter for a benchmark:

| Area | Current state | Why it matters |
| --- | --- | --- |
| **Vsync cap** | Frame time is the interval between `requestAnimationFrame` callbacks ([display_driver.ts:41-60](../src/drivers/display_driver.ts#L41-L60)). In [img/benchmark_rtx5080.csv](../img/benchmark_rtx5080.csv), Forward+ and clustered deferred both floor at 8.33 ms (120 Hz) and step at 16.7/25/33 ms. | We're measuring the display, not the GPU. Every fast result collapses to the refresh rate. **This is the #1 blocker.** |
| **Resolution** | Fixed in §6.2. Frames render offscreen at 1080p, 1440p, or 2160p, picked in the GUI ([main.ts](../src/main.ts)), and are letterboxed onto the canvas, which follows window resizes. Switching rebuilds the renderer's targets. | Tier presets (§3.2) should select these instead of the GUI. The old benchmark CSV doesn't record the resolution. |
| **Determinism** | Light colors use `Math.random()` ([lights.ts:204](../src/stage/lights.ts#L204)). Light motion is driven by wall-clock rAF time ([lights.ts:233-234](../src/stage/lights.ts#L233-L234)). The camera is keyboard/mouse only ([camera.ts:134](../src/stage/camera.ts#L134)). | The workload differs from run to run. |
| **Protocol** | 30 warm-up frames, 120 sample frames, one pass, min/avg/max only ([benchmark.ts:86-92](../src/testing/benchmark.ts#L86-L92)). Pipelines compile synchronously when the renderer is constructed. | Too short to be stable. No percentiles or variance. Shader-compile hitches land in the measured window. |
| **Architecture** | Fixed in §6.1–6.2. `GpuContext` replaced the module-level globals. Renderers only encode frames, and a `DisplayDriver` ([display_driver.ts](../src/drivers/display_driver.ts)) owns the rAF loop. | The uncapped throughput driver (§3.1) still needs building on top. |
| **Materials** | Fixed in §6.3–6.4. Textures are sRGB-correct and mipmapped. Lighting is HDR with an ACES tonemap and metallic-roughness PBR. Normal maps, glTF factors, and alpha modes are used. | There's no ambient or environment light yet, so unlit metal reads as black. |
| **Clustering cost** | Fixed in §6.6. Clustering now runs as frustum culling, then shared-memory batched assignment into a compact 8 MB index list. It has no large private arrays. Light radius and cluster dimensions are still compile-time constants ([shaders.ts](../src/shaders/shaders.ts)). | Light radius can't change per preset yet (week 2). |
| **Clustered deferred G-buffer** | Fixed in §6.5. Position is rebuilt from `depth32float`. The G-buffer is two packed 4-byte targets ([clustered_deferred.ts](../src/renderers/clustered_deferred.ts)). | — |
| **Product** | dat.gui + stats.js, alert/confirm dialogs, CSV auto-download. | No run flow, results page, history, or leaderboard. |
| **Build hygiene** | `tsc --noEmit` reports 5 errors: two typed-array errors in scene.ts (`writeBuffer` with `ArrayBufferLike` views) and unused variables in main.ts, shaders.ts, and benchmark.ts. The build doesn't type-check. Scenes are copied with `cp -r` ([package.json:8](../package.json#L8)). | Fix in week 1 and gate CI on it. |
| **Hosting** | GitHub Pages can't set response headers. [vite.config.ts](../vite.config.ts) allows `renderrank.tonyxtian.com` as a *dev-server* host. | We need COOP/COEP headers (finer timers) and a real production host, not `vite dev`. |

---

## 3. Measurement methodology

This section is the core of the project. Everything else depends on it, and we'll publish it as the methodology document in December.

### 3.1 Escaping vsync: the throughput loop

Browsers don't let pages disable vsync, and `requestAnimationFrame` is paced by the display. For scored runs we **don't render to the canvas in the measured loop**. Instead:

- Each frame renders into offscreen render targets at the tier resolution.
- Frames are submitted back to back, with at most `maxInFlight` (2) frames queued. We wait on `queue.onSubmittedWorkDone()` for backpressure.
- A rAF callback only raises a "present" flag. When it's set, the loop blits the latest finished frame to the canvas (one cheap scaled copy) so the user sees the test. The blit costs the same on every device and is the same for every result.
- **FPS = frames completed ÷ wall time** from the first measured submit until the last frame's work-done promise resolves.

```ts
// bench/driver.ts (sketch)
async function measure(test: GraphicsTest, timeline: Timeline, maxInFlight = 2): Promise<Pass> {
  const pending: Promise<void>[] = [];
  const completions: number[] = [];
  let frames = 0;
  const t0 = performance.now();
  for (let t = 0; t < timeline.durationMs; t = performance.now() - t0) {
    test.encodeFrame(timeline.at(t));               // all passes into offscreen targets
    pending.push(device.queue.onSubmittedWorkDone().then(() => { completions.push(performance.now()); }));
    if (pending.length >= maxInFlight) await pending.shift();
    if (presentRequested) { presentToCanvas(); presentRequested = false; }
    frames++;
  }
  await Promise.all(pending);
  const elapsedMs = performance.now() - t0;
  return { frames, elapsedMs, fps: frames / (elapsedMs / 1000), frameIntervalsMs: diffs(completions) };
}
```

**Week-1 spike:** confirm this really is uncapped on Chrome/Edge (Windows, macOS, Android), Safari, and Firefox. Run GT1-Light on a fast dGPU and check that FPS goes well above the refresh rate. Also confirm that rAF still fires during the loop. If some browser still couples to the display, we fall back to making each tier heavy enough to stay below 60 FPS on its target hardware, and we flag results within 3% of a refresh-rate multiple as `display-limited`.

**Display mode** (Explore mode and the optional "smoothness" readout) keeps rAF pacing and reports display FPS and frame-time percentiles separately, as the README promises. It's never used for the score.

### 3.2 Fixed resolution

Every test renders at its tier's internal resolution (Light 1920×1080, Standard 2560×1440, Extreme 3840×2160), whatever the canvas size or DPR. The canvas gets a scaled blit. Resizing the window during a run doesn't change the workload.

### 3.3 Timeline and determinism

We use the 3DMark model: **a fixed-duration content timeline** (Lights 30 s, Crowd 30 s at Standard). Simulation time comes from the benchmark clock, not rAF. Faster GPUs render more frames of the *same* timeline. Slow devices finish in the same wall time instead of taking minutes, and the score stays proportional to throughput.

- Camera: Catmull-Rom spline through authored keyframes (`{t, position, target, fov}`), stored as JSON in the suite.
- Lights: a seeded PRNG (mulberry32; tiny, no dependency) for colors and noise offsets. The `time` uniform is the timeline time.
- Crowd animation and any particles: functions of timeline time only.
- **Probe frames:** at K fixed timeline points (for example t = 5, 15, 25 s), outside the measured window, we render the exact frame at low resolution, read it back, and hash it. These hashes support validation (see [§9.4](#94-validation-and-anti-cheat)) and regression tests.

### 3.4 Run protocol

| Phase | What happens | Measured |
| --- | --- | --- |
| Pre-flight | Check adapter limits and features for the tier. Reject `isFallbackAdapter` for ranked runs. Check visibility and battery. Measure the refresh rate and timer resolution. Request fullscreen and a screen wake lock. If Compute Pressure reads `serious` or higher, offer a cool-down wait ([§10.1](#101-browser-api-inventory)). | — |
| Load | Download assets (cached) and upload them to the GPU. Create **all** pipelines with `create*PipelineAsync`. | Load time (diagnostic) |
| Warm-up | Play the first 5 s of the timeline in the throughput loop to absorb lazy driver compiles and clock ramp-up. | — |
| Measure | Full timeline per test. **Ranked = 2 repeats per test**, and the test score is the median. | FPS, frame intervals |
| Probes | Render probe frames and hash them. Run the GPU clock probe after warm-up, after each repeat, and at the end ([§10.2](#102-signals-we-measure-ourselves-clock-and-throttling-proxies)). Probes never run inside a measured window. | Relative clock speed |
| Report | Per-test FPS, coefficient of variation (CV), p50/p95/p99 frame interval, flags. | — |

If CV across the two repeats is above 3%, the run gets a `high-variance` flag and one automatic third repeat. A run that's still above 3% is shown but not ranked.

### 3.5 Environment guards (automatic flags)

`tab-hidden` (Page Visibility API), `focus-lost`, `resized` (harmless, since resolution is fixed, but logged), `device-lost` (abort), `fallback-adapter`, `on-battery` (Battery API where available, warning only), `custom-settings`, `display-limited`, `high-variance`, `not-isolated` (not cross-origin isolated), `light-overflow` (the clustered light index list filled up and dropped lights; read with `Lights.readClusteringStats()`). Any flag except `resized` and `on-battery` makes a run ineligible for the ranked leaderboard, but it can still be saved locally.

**Warnings** from telemetry ([§10](#10-system-telemetry-beyond-webgpu)) are shown on the result and can be filtered on the leaderboard, but they don't block ranking:

- `pressure-serious`: 10% or more of measured time in Compute Pressure `serious` or `critical`.
- `throttling-suspected`: clock probe drops more than 5%, or repeat drift is below −3%.
- `power-saving-suspected`: refresh rate measures 30 Hz on a 60 Hz-class device.
- `main-thread-stalls`

Throttling is part of how a device really performs, so we report it rather than reject it. That's also how 3DMark treats it. `gpu-oom` is a hard flag, like `device-lost`.

Request the adapter with `powerPreference: 'high-performance'` so dual-GPU laptops use the discrete GPU, and record which adapter we got.

### 3.6 Timers and GPU timestamps

- `performance.now()` is coarsened (100 µs or worse) unless the page is **cross-origin isolated**, which needs COOP/COEP response headers. Throughput over 30 s is fine at any resolution. Frame-interval percentiles need isolation to be meaningful, which is one reason to move hosting (see [§9.1](#91-stack)).
- Request `timestamp-query` when the adapter offers it, and record **per-pass GPU time** (clustering, G-buffer, lighting, shadows, post). Values are quantized by the browser, so they're **diagnostics only**: shown as a breakdown chart, never used in the score.

### 3.7 Scoring

For a tier with tests *i* and weights *wᵢ* (equal by default):

```
GraphicsScore = C_tier × ( Σ wᵢ ) / ( Σ wᵢ / FPSᵢ )
```

We use the harmonic mean because it weighs each test by the time it takes, so a GPU can't hide a weak test behind a strong one. That's also how 3DMark combines tests. `C_tier` is chosen once, at the workload freeze, so a reference device scores a round number (for example 10,000 on Standard). It never changes within a suite major version.

### 3.8 Versioning and the workload hash

A **suite version** (semver) pins shaders, presets, assets, camera paths, and scoring. A build step computes a **workload hash** (SHA-256 over shader sources, preset JSON, the asset manifest, and camera paths) and embeds it. Results carry it, and the server only ranks hashes on its accepted list.

- **Major version bump:** anything that changes the workload. Scores aren't comparable, so the leaderboard gets a new board.
- **Minor/patch:** UI, bug fixes that don't change rendered output, or new tests that add a board without changing existing ones.

Renderer optimizations (like the clustering rewrite) change scores, so they must land **before v1.0.0 is frozen**.

---

## 4. Test suite: *Atrium v1*

Both tests use Sponza for v1, which keeps asset work manageable. They stress different parts of the GPU.

### GT1 "Lights": fragment shading and light culling

- Clustered deferred shading with PBR (GGX + Lambert, metallic-roughness, normal maps), HDR target, tonemap.
- Many moving point lights plus one shadow-casting directional sun (cascaded shadow map).
- Camera: slow fly-through of the atrium, nave, and upper galleries (high light overlap).

### GT2 "Crowd": geometry throughput, compute, and post-processing

- Thousands of instanced animated characters in the courtyard, animated with **vertex animation textures** (VAT, baked from a skinned clip). This gives us crowds without a skinning system.
- GPU-driven rendering: a compute pass does frustum culling and LOD selection, then `drawIndexedIndirect`.
- Post chain: SSAO, bloom, tonemap.
- Fewer lights than GT1, so the bottleneck moves.
- Characters: CC0 assets (for example Quaternius or Kenney). Record license and source in `scenes/README`.

### Tiers (initial values, tuned in calibration week)

| | Light | Standard | Extreme |
| --- | --- | --- | --- |
| Internal resolution | 1920×1080 | 2560×1440 | 3840×2160 |
| GT1 lights | 512 | 2,048 | 4,096 |
| GT1 shadow cascades | 1 (1024²) | 3 (2048²) | 4 (4096²) |
| GT2 characters | 2,000 | 10,000 | 30,000 |
| GT2 SSAO / bloom | half-res / on | full-res / on | full-res / on |
| Required limits | WebGPU defaults | defaults | `maxBufferSize` ≥ 1 GB |
| Target hardware | iGPU, Apple M-base, phones | mid-range dGPU | high-end dGPU |

**Light must run on default WebGPU limits.** It's the cross-platform tier, the equivalent of 3DMark's Wild Life, and the only one we expect phones to run.

**Custom runs** expose every preset knob: resolution, light count, light radius, cluster dimensions, shadows, SSAO, bloom, and crowd size. Custom results are always labeled and never ranked.

---

## 5. Target architecture

The **engine is framework-free TypeScript**. The UI calls it through a small API, so the UI framework choice doesn't leak into rendering code, and the engine can be driven headlessly in tests.

```
src/
  engine/
    gpu/        context.ts (adapter/device/limits/features, device-loss, allocation accounting), targets.ts, mipmaps.ts, timestamps.ts
    scene/      gltf.ts (loader), graph.ts, camera.ts (free-fly), camera_path.ts, lights.ts, rng.ts
    render/     passes/ (clustering, gbuffer, lighting, shadows, ssao, bloom, tonemap, present)
                techniques/ (clustered_deferred), shaders/ (*.wgsl + preprocessor)
    bench/      driver.ts (throughput + display loops), timeline.ts, protocol.ts, stats.ts,
                score.ts, environment.ts (device info + flags), probes.ts (frame hashes),
                telemetry.ts (browser-API collectors), microbench.ts (clock/bandwidth/CPU probes)
    suites/     atrium/ (gt1_lights.ts, gt2_crowd.ts, presets/*.json, paths/*.json, suite.ts)
    index.ts    public engine API
  app/          UI: routes, components, charts, storage (IndexedDB history)
  shared/       result schema (zod), suite registry/version constants. Imported by app/ and api/
api/            serverless backend (see §9)
tools/          asset pipeline (gltf-transform), camera-path recorder, workload-hash build step
public/scenes/  versioned, content-hashed assets (or object storage; see §7)
```

Where today's files go: [renderer.ts](../src/renderer.ts) splits into `gpu/context.ts` plus a `Technique` base without the self-started rAF loop. [renderers/](../src/renderers/) becomes `render/techniques/`. [stage/](../src/stage/) becomes `scene/`. [testing/benchmark.ts](../src/testing/benchmark.ts) is replaced by `bench/`.

### Core interfaces

```ts
interface GraphicsTest {
  readonly id: string;                                   // 'atrium.gt1'
  load(ctx: GpuContext, preset: Preset, assets: AssetStore, onProgress: (p: number) => void): Promise<void>;
  encodeFrame(t: TimelineSample): void;                  // encode + submit one frame into offscreen targets
  outputTexture(): GPUTexture;                           // what present/probes read
  timestampLabels(): string[];                           // per-pass diagnostics
  dispose(): void;
}

interface Suite {
  id: string; version: string; workloadHash: string;
  tiers: Record<TierId, { tests: { test: () => GraphicsTest; weight: number; timeline: TimelineSpec }[];
                          preset: Preset; scoreConstant: number; requiredLimits: Partial<GPUSupportedLimits> }>;
}

// engine/index.ts — everything the UI needs
runBenchmark(opts: { suite: Suite; tier: TierId; mode: 'ranked' | 'custom'; overrides?: Partial<Preset> },
             events: { onPhase, onProgress, onFlag }): Promise<RunResult>;
startExplore(canvas: HTMLCanvasElement, preset: Preset): ExploreSession;
detectEnvironment(): Promise<Environment>;
```

Uniform data that varies by preset (light count, light radius, cluster dimensions) moves from compile-time constants into uniforms or pipeline-overridable constants (WGSL `override`). This lets one build serve every tier and custom settings.

---

## 6. Renderer work items

Ordered so everything that changes the workload lands before the freeze.

1. **GpuContext refactor.** Remove the module globals, handle `device.lost`, request `timestamp-query` when available, and record adapter info and limits. **Done:** [src/gpu/context.ts](../src/gpu/context.ts).
2. **Decouple the frame loop.** Techniques encode frames; drivers own the loop. Add offscreen targets plus the present blit. **Done:** [renderer.ts](../src/renderer.ts), [display_driver.ts](../src/drivers/display_driver.ts), [present.ts](../src/passes/present.ts). The throughput driver itself is §3.1.
3. **Color pipeline.** sRGB base color, mipmap generation (render-pass downsample at load), `rgba16float` HDR lighting target, tonemap pass (ACES fit or AgX). **Done:** [mipmaps.ts](../src/gpu/mipmaps.ts), [tonemap.ts](../src/passes/tonemap.ts). Exposure is `toneMappingExposure` in [shaders.ts](../src/shaders/shaders.ts). Full mip chains raise Sponza's texture memory from ≈270 MB to ≈360 MB, which the §7 asset pipeline should bring down.
4. **PBR + normal mapping.** Use the existing TANGENT attribute and metallic-roughness textures. Use alpha cutoff from the material rather than the hardcoded 0.5. **Done:** GGX + Lambert in [common.wgsl](../src/shaders/common.wgsl), material uniforms and default maps in [scene.ts](../src/stage/scene.ts), and normal mapping in [clustered_deferred.fs.wgsl](../src/shaders/clustered_deferred.fs.wgsl).
   - Applying glTF's `baseColorFactor` (0.588 on every Sponza material) darkened the frame, so exposure went from 1.0 to 1.7.
   - Back-face culling for single-sided materials is still off. Turning it on would change the workload, so decide before the freeze.
5. **G-buffer rework.** Reconstruct position from depth, store octahedral normals, pack roughness and metallic. **Done:** [clustered_deferred.ts](../src/renderers/clustered_deferred.ts), with encode, decode, and reconstruction in [common.wgsl](../src/shaders/common.wgsl).
   - **Layout:** `rgba8unorm-srgb` holds base color + metallic. `rgb10a2unorm` holds a 10:10 octahedral normal + 10-bit roughness. `depth32float` is now sampled (it was `depth24plus`, whose physical format varies by backend).
   - **Size:** 8 bytes per pixel written instead of 20; 17 MB instead of 41 MB at 1080p.
   - **Check:** a frozen-time A/B render against the old layout differs by a mean of 0.1/255. The only outliers are on surfaces almost touching a light, where the old `rgba16float` positions (≈0.008-unit steps) were the less accurate ones.
6. **Clustering rewrite.** **Done:** three dispatches in one compute pass, set up in [lights.ts](../src/stage/lights.ts).
   - Compute cluster AABBs only when the projection or resolution changes. *Done: [cluster_bounds.cs.wgsl](../src/shaders/cluster_bounds.cs.wgsl) runs on the first frame only.*
   - Cull lights to the view frustum first. *Done: [light_culling.cs.wgsl](../src/shaders/light_culling.cs.wgsl) uses world-space planes from the view-projection matrix and compacts survivors, in view space, with an atomic counter. 368 of 500 lights survive on the opening view.*
   - Load lights in workgroup-shared batches. *Done: [light_assignment.cs.wgsl](../src/shaders/light_assignment.cs.wgsl) uses 64 clusters per workgroup and streams lights in 64-light batches.*
   - Build a compact index list with an atomic counter instead of 1,500 fixed slots per cluster, and set an overflow flag. *Done: each cluster counts, reserves one contiguous run with a single `atomicAdd`, then writes into it. The list holds 2²¹ indices (8 MB, down from ≈21 MB). The opening view needs ~48k at 500 lights and ~560k at 5000. Overflow sets a flag (`light-overflow`, §3.5) instead of corrupting memory.*
   - Must pass on default limits (Light tier). *Done: 1 KB of workgroup memory, at most 128 invocations per workgroup, 6 storage buffers per stage.*
   - **Check:** frozen-time A/B against the old clustering was bit-identical at 500 lights and within 1/255 at 5000. A forced overflow raised the flag with no errors.
   - The order of lights within a cluster now depends on atomics, so float summation order can vary frame to frame by about 1 LSB. Probe-hash tolerance (item 10) has to allow for that.
7. **Shadows.** Cascaded shadow map for the sun (GT1).
8. **GT2 pipeline** (with Stan). VAT instanced characters, compute culling and LOD into an indirect buffer, SSAO, bloom.
9. **Diagnostics.** Per-pass timestamp queries resolved into a ring of readback buffers, so we never stall the GPU.
10. **Probe frames.** Low-resolution render, readback, and a perceptual hash (dHash on luminance) for each probe point.

---

## 7. Assets and loading

- **Pipeline (`tools/assets`).** Use `gltf-transform` to dedupe, add meshopt geometry compression, resize oversized textures, and re-encode for transport (WebP, or AVIF where supported). Target under 20 MB for Sponza.
- **Keep GPU formats uncompressed (`rgba8unorm-srgb`) in v1.** Transcoded formats such as KTX2/Basis become BC7 on desktop but ASTC/ETC2 on mobile, which changes the workload across platforms. Transport compression changes download size only.
- **Caching.** Content-hashed URLs from an asset manifest, stored in the Cache Storage API, so second runs start instantly. Show the download size before the first run.
- **Hosting assets.** Keep them out of the JS bundle (`public/` or object storage behind the same domain). Sponza already adds 51 MB to git history, so new suites should use Git LFS or object storage rather than plain git.
- **Loader hardening.** Handle a missing material, missing UVs/tangents, and `UNSIGNED_BYTE` indices. Today these throw or are untested ([scene.ts](../src/stage/scene.ts) header comment).

---

## 8. Frontend and UX

Routes (hash routing, so the static host needs no rewrite rules):

| Route | Purpose |
| --- | --- |
| `/` | Detect device. Show GPU, browser, and OS. Recommend a tier from limits and a 2-second probe. Big **Run** button. |
| `/suite/atrium` | Tests, tiers, requirements, download size. Ranked vs. Custom toggle with the custom settings panel. |
| `/run` | Fullscreen. Phases: pre-flight checks, loading (asset + shader progress), each test with a minimal HUD and progress bar, then the transition to results. Esc aborts. |
| `/result/:id` | Score, per-test FPS, frame-interval chart, variance, per-pass GPU breakdown, system info, flags explained in plain words, "faster than X% of <GPU> results", share link, JSON/CSV export, **Submit** (opt-in). |
| `/history` | Local results (IndexedDB). Select two to compare side by side. |
| `/leaderboard` | Filter by suite version, tier, GPU, browser, OS. Default view: **median score per GPU model**, with run counts. Top-single-run view as secondary. |
| `/explore` | Today's sandbox: free camera, all toggles, display FPS. Camera-path recording for authors. |

- **UI framework.** Recommend React + Vite, since it's the most widely known and has good chart libraries. Eric has final say; the engine API doesn't depend on it.
- **WebGPU missing.** Replace the current `<h1>` with a page listing supported browsers and how to enable WebGPU.
- **Accessibility and phones.** Results and leaderboard must work at phone width. The run screen locks orientation where possible.

---

## 9. Backend, leaderboard, and validation

### 9.1 Stack

Recommendation: **Cloudflare Pages (static) + Pages Functions / Workers (API) + D1 (SQLite)**, on the `renderrank.tonyxtian.com` domain.

- One origin for the app and the API, and a free tier that fits a student project.
- A `_headers` file sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which gives us cross-origin isolation (see [§3.6](#36-timers-and-gpu-timestamps)). GitHub Pages can't set these.
- Turnstile is available for bot protection on submit.

The alternative is Supabase (Postgres + REST). It's fine too, but it still needs a separate static host with header control.

### 9.2 Result schema (shared/, validated with zod on both ends)

```ts
interface RunResult {
  schemaVersion: 1;
  suite: { id: 'atrium'; version: string; workloadHash: string; tier: 'light' | 'standard' | 'extreme' };
  mode: 'ranked' | 'custom';
  preset: Preset;                          // full effective settings, ranked or custom
  graphicsScore: number;
  tests: {
    id: string; weight: number; fps: number;                    // fps = median of repeats
    repeats: { frames: number; elapsedMs: number; fps: number }[];
    cv: number;
    frameIntervalMs: { p50: number; p95: number; p99: number; max: number };
    gpuPassMs?: Record<string, number>;                         // diagnostics only
    probeHashes: string[];
  }[];
  environment: {
    gpu: { vendor: string; architecture: string; device?: string; description?: string;
           webglRenderer?: string; normalizedModel?: string; userLabel?: string };
    browser: { name: string; version: string }; os: { name: string; version?: string };
    features: string[]; limits: Record<string, number>;
    crossOriginIsolated: boolean; devicePixelRatio: number; cpuThreads: number; onBattery?: boolean;
  };
  flags: string[];                         // hard flags and warnings (§3.5)
  telemetry: Telemetry;                    // §10.4. Submitted copies carry summaries only.
  createdAt: string;
  clientId: string;                        // random UUID in localStorage. Not an account, not a fingerprint.
}
```

### 9.3 API

| Endpoint | Behavior |
| --- | --- |
| `POST /api/results` | Turnstile token required. Validates the schema, checks `workloadHash` against the accepted list, **recomputes the score** from `tests[].repeats`, runs plausibility checks, stores the result, returns `{ id, rankedEligible }`. |
| `GET /api/results/:id` | Public result page data. |
| `GET /api/leaderboard?suite=atrium@1&tier=standard&groupBy=gpu` | Aggregates: median, p25/p75, count per group. |
| `GET /api/percentile?suite&tier&gpu&score` | "Faster than X%" on the results page. |
| `POST /api/results/:id/report` + admin hide | Lightweight moderation. |

Local history lives in IndexedDB, works fully offline, and needs no account. Accounts and cross-device sync are spring work.

### 9.4 Validation and anti-cheat

The client is untrusted and a determined cheater can forge a payload. The goal is to keep the board free of broken runs and casual tampering, and to be honest about that in the methodology.

- The server recomputes everything derivable (score from repeats, CV, flags from data), and rejects unknown workload hashes and stale suite versions.
- **Probe hashes** must be within a Hamming-distance tolerance of the reference hashes for that suite version. This catches skipped passes, reduced resolution, and disabled effects. The tolerance absorbs vendor rounding differences; calibrate it on the device matrix.
- Plausibility checks: FPS vs. tier minimums, `frames ≈ fps × duration`, and outliers beyond the 99.5th percentile for the GPU group go to review instead of the board.
- Rate limit by a salted hash of IP (never store the raw IP), plus Turnstile.

### 9.5 Device identification and privacy

WebGPU deliberately exposes little: `adapter.info` usually gives vendor and architecture, and often leaves out the model. We combine:

1. `adapter.info`, including subgroup sizes as a GPU-family hint.
2. The WebGL `WEBGL_debug_renderer_info` unmasked renderer string, where the browser still exposes it.
3. UA Client Hints for browser and OS version, plus the device `model` on Android, which maps to the SoC and GPU.
4. Measured bandwidth class from the bandwidth probe, as a sanity check against the claimed model.
5. A **normalization table** in `shared/` that maps all of the above to a canonical GPU model (for example `NVIDIA GeForce RTX 5080`).

Availability and caveats for each source are in [§10.1](#101-browser-api-inventory).

When we can't identify the model, the user picks it from a list. Those results are grouped as **self-reported** and visibly marked.

Privacy rules (from the README's "responsible design"): submission is opt-in per result, there are no accounts in v1, there's no raw IP storage, and we collect only the fields in the schema above. Telemetry is summarized before submission ([§10.4](#104-what-gets-recorded-and-what-leaves-the-device)). The results page shows exactly what will be sent before Submit.

---

## 10. System telemetry beyond WebGPU

WebGPU tells us very little about the hardware, and that's deliberate: every extra detail helps fingerprint users. **No browser API reports temperature, GPU or CPU clock speed, power draw, fan speed, GPU utilization, or VRAM usage.** We get closer to 3DMark's hardware monitoring with four layers, from always-available to opt-in:

1. **Cross-browser APIs**, collected on every run.
2. **Chromium-only APIs**, feature-detected and collected when present. Each collector returns `undefined` when its API is missing, and nothing breaks.
3. **Signals we measure ourselves**: a GPU clock probe, a bandwidth probe, and repeat drift. These are our only clock and throttling signals, and they work in every browser.
4. **Opt-in ground truth**: the user's own sensor logs (public), or a lab setup on the team's machines.

**None of this feeds the score.** It explains results ("your laptop throttled 9% during GT2"), sets warnings, and validates our methodology.

### 10.1 Browser API inventory

**Thermal and system load**

| API | What it gives | Availability | How we use it |
| --- | --- | --- | --- |
| Compute Pressure (`PressureObserver`) | Coarse state per source: `nominal` / `fair` / `serious` / `critical`. The spec defines the states in terms of "pressure, temperature and/or energy usage", and `serious` notes that "the system may be throttling". The algorithm is implementation-defined and deliberately non-deterministic. | Chromium only (stable since Chrome 125). The spec and Chrome define only the `"cpu"` source. WebKit opposes the spec; Mozilla's position is pending. | Observe at 1 s intervals for the whole run and store a state timeline. **Pre-flight:** if the state is `serious` or higher, show a cool-down screen until it drops (skippable). Our tests are GPU-bound, so this mostly reveals background load and shared thermal limits on laptops, Apple silicon, and phones. Also check `PressureObserver.knownSources` and subscribe to `"thermals"` if a browser ever exposes it. |

**This is the only temperature-adjacent signal in any browser.** It's a hint, not a reading. Everything else about heat comes from §10.2 and §10.3.

**Memory**

| API | What it gives | Availability | How we use it |
| --- | --- | --- | --- |
| `navigator.deviceMemory` | Approximate RAM in GiB, bucketed. The spec recommends clamping to 0.25–8; recent Chrome reportedly reports higher values on desktop (verify on our devices). | Chromium | Leaderboard context. Tier recommendation on unified-memory devices, where RAM is also VRAM. |
| `performance.measureUserAgentSpecificMemory()` | The page's memory (JS, DOM, …) with a per-type breakdown. Waits for garbage collection, so a result can take seconds. | Chromium 89+, **requires cross-origin isolation** (which we get from §9.1) | Sample after load and after the last test to catch leaks between repeats, and report page memory. It doesn't cover GPU memory. |
| `navigator.storage.estimate()` / `persist()` | Storage quota and usage | All major browsers | Before downloading assets, check there's room to cache them. Request persistence so cached assets survive. |
| **GPU memory: our own accounting** | Exact bytes of every buffer and texture we create (format × size × mips × layers) | Ours, works everywhere | `GpuContext` wraps `createBuffer` / `createTexture` and tracks the peak per test. This sets honest "requires ~X GB GPU memory" text per tier. It doesn't include driver overhead. |
| WebGPU `out-of-memory` error scopes + `device.lost` (`reason`, `message`) | Allocation failures and device loss | All WebGPU browsers | Wrap large allocations so a test fails cleanly with a `gpu-oom` flag instead of a dead tab. |

**We won't probe VRAM by allocating until out-of-memory.** It can lose the device for other tabs, and on unified-memory machines it pushes the OS into swap.

**Hardware identification** (feeds the normalization table in [§9.5](#95-device-identification-and-privacy))

| API | What it gives | Availability | How we use it |
| --- | --- | --- | --- |
| `GPUAdapterInfo` (`adapter.info`) | `vendor`, `architecture`, often-empty `device` / `description`, `subgroupMinSize` / `subgroupMaxSize`, `isFallbackAdapter` | All WebGPU browsers, but fields vary. Firefox's fingerprinting resistance substitutes fixed values. | Primary vendor and architecture source. Subgroup sizes differ by GPU family, so they serve as a consistency hint. |
| `adapter.features` / `adapter.limits` | Supported features and limits | All WebGPU browsers | Tier eligibility. Which texture-compression features are present (`-bc` vs. `-etc2` / `-astc`) separates desktop-class from mobile-class GPUs. |
| WebGL `WEBGL_debug_renderer_info` | Unmasked renderer string | Chrome: full string (for example `ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 …)`). Firefox: sanitized or bucketed, and disabled under `resistFingerprinting`. Safari: reportedly generic. | The best GPU-model source on Chromium. Also reveals the ANGLE backend. |
| UA Client Hints `navigator.userAgentData.getHighEntropyValues([...])` | `architecture`, `bitness`, `model` (the phone model on Android), `platformVersion` (Windows 10 vs. 11), `fullVersionList`, `formFactors`, `wow64` | Chromium. Governed by the `ch-ua-high-entropy-values` Permissions-Policy (default self). | Exact browser and OS version for every result. Android `model` maps to SoC and GPU, which fills the biggest identification gap. |
| `navigator.hardwareConcurrency` | Logical CPU cores (some browsers clamp it) | All | CPU context on the results page. |

**Display, power, and run conditions**

| API | What it gives | Availability | How we use it |
| --- | --- | --- | --- |
| rAF interval measurement (ours) | Display refresh rate. There's no API for it. | All | Measure for 1 s during pre-flight, for the `display-limited` flag ([§3.1](#31-escaping-vsync-the-throughput-loop)). A 30 Hz reading on a 60 Hz phone points to a power-saving mode such as iOS Low Power Mode, which gets a warning. |
| `screen.*`, `devicePixelRatio`, `matchMedia('(dynamic-range: high)')` | Screen size, scale, HDR capability | All | Results-page context only. Resolution is fixed, so these don't change the workload. |
| Battery Status (`navigator.getBattery()`) | Charge level, charging state | Chromium | `on-battery` warning. Laptops often cap the GPU on battery. |
| Screen Wake Lock (`navigator.wakeLock.request('screen')`) | Stops the screen dimming or sleeping mid-run | Chrome, Edge, Safari 16.4+, Firefox 126+ | Hold it for every run, and especially the stress test. It's run-condition control rather than data. |
| Network Information (`navigator.connection`) | `effectiveType`, `downlink`, `saveData` | Chromium | Estimate first-run download time. Warn before a large download on `saveData`. |

**Stability and failures**

| API | What it gives | Availability | How we use it |
| --- | --- | --- | --- |
| Long Animation Frames (`PerformanceObserver`, `'long-animation-frame'`) | Main-thread stalls with script attribution | Chromium 123+ | Correlate frame-interval spikes with main-thread stalls (garbage collection, extensions). Count and longest go into the result. |
| WebGPU `uncapturederror` events | Validation and internal errors | All WebGPU browsers | Counted. Any error during a ranked run makes it ineligible. |
| Reporting API crash reports (`Reporting-Endpoints` header) | After a tab crash, the browser later posts a report with `reason` (`oom` or `unresponsive`) | Chromium. Delivered on a later page load. Not yet in a current spec. | Without this we never learn which device and tier combinations crash the tab, because the page dies before it can report. Needs header control (§9.1). Aggregate only, and stated in the privacy notes. |
| Timer self-test | Measured `performance.now()` granularity, plus `crossOriginIsolated` | All | Recorded with every result, so we know how much to trust its frame-interval percentiles. |

APIs we considered and **won't use**: `performance.memory` (non-standard, deprecated, coarse; superseded by `measureUserAgentSpecificMemory`); the Window Management API (permission prompt, little value at a fixed resolution); and WebCodecs / `mediaCapabilities` hardware-decode hints (weak GPU signal).

### 10.2 Signals we measure ourselves (clock and throttling proxies)

There's no clock-speed API, but a workload whose cost depends only on clock speed works as a speedometer.

- **GPU clock probe.** A tiny compute dispatch: each invocation runs a long dependent FMA chain in registers, with no memory traffic, across enough workgroups to fill the GPU. Its duration is roughly proportional to 1 / core clock. Calibrate the iteration count once at pre-flight so a probe takes about 5 ms; that keeps the 100 µs timestamp quantization under 2%. Time it with `timestamp-query` when available, otherwise with a dedicated submit plus `onSubmittedWorkDone()` and a 20 ms probe.
  - **When:** after warm-up (the baseline, 1.0), right after each measured repeat, and after the last test. Probes never run inside a measured window, so they can't affect the score.
  - **Back-to-back:** each probe runs immediately after rendering, while the GPU is still at load clocks. A probe after an idle gap measures clock ramp-up instead.
  - **Output:** a relative-speed series (`1.0, 0.99, 0.94, …`), not MHz. A drop of more than 5% raises `throttling-suspected`. Local history also stores the baseline: "your GPU is running 12% slower than at the start of your last run; it may still be warm."
- **Bandwidth probe.** A large `copyBufferToBuffer` (sized to the tier's limits) gives effective memory bandwidth in GB/s. It's useful for explaining results ("GT2 is bandwidth-bound on this device") and for spotting misreported GPU models, since bandwidth classes are distinctive.
- **Repeat drift.** We already run every test twice on identical content, so `fps(repeat 2) / fps(repeat 1) − 1` isolates anything that changed over time: heat, boost decay, background load. It costs nothing. Drift beyond −3% also raises `throttling-suspected`.
- **CPU probe** (small): a fixed WASM loop in a worker before and after the run. It gives relative CPU speed and shows CPU throttling, which matters because the JS side encodes every frame.

The cut-off values (5%, −3%) are starting points. We calibrate them against real clock and temperature logs in the lab (§10.3).

### 10.3 Opt-in ground truth

- **Lab mode** (team only, December scope). Opened with a `?lab` URL parameter, on Chrome with `chrome://flags/#enable-webgpu-developer-features` enabled. The flag removes timestamp quantization and adds non-standard adapter fields:
  - `driver`, `backend` (D3D12 / Metal / Vulkan…), `type` (discrete / integrated), `powerPreference`.
  - `memoryHeaps`: VRAM heap sizes. This is the only VRAM total any browser exposes.

  We run a hardware logger alongside (commands below) and import its log. Lab mode exists to **validate the methodology**: check that clock-probe drops match real clock drops, that repeat drift tracks temperature, and to put ground truth in the repeatability report. Lab results are tagged and never ranked.
  - Bonus cross-check: on Chrome launched with vsync and the frame-rate limit disabled (`--disable-gpu-vsync --disable-frame-rate-limit`; verify these switches on current Chrome), uncapped rAF FPS should match our throughput-loop FPS.
- **Sensor-log import** (public, spring). Users who want temperatures and clocks run a logger they already trust. We publish exact commands, they drop the CSV on the results page, and it's **parsed in the browser**, aligned by wall-clock time (each result records its start time), and charted under the FPS timeline. It's attached to a submission only if they choose, and labeled "user-supplied, unverified." This keeps the no-install promise for everyone else. Parsers to support:
  - NVIDIA (all OSes): `nvidia-smi --query-gpu=timestamp,temperature.gpu,clocks.gr,clocks.mem,power.draw,utilization.gpu,memory.used --format=csv -lms 500`
  - Windows (any vendor): HWiNFO CSV logging, MSI Afterburner logs.
  - macOS: `sudo powermetrics --samplers gpu_power,thermal -i 500`. This gives GPU frequency and power plus the thermal pressure level, not temperatures.
  - Linux: `amdgpu_top`, `intel_gpu_top`.
- **Native helper** (evaluate in spring; don't build now). A small companion app exposing NVML, ADLX, IOReport, or sysfs sensors on `127.0.0.1` would give a live overlay. Costs:
  - It breaks "no install", so it can only ever be optional.
  - Chrome's Local Network Access permission prompt (Chrome 141/142+) now gates public-site requests to localhost.
  - It needs code signing and notarization.
  - It adds a local attack surface: it must check `Origin` and bind to loopback only.

  Log import gets most of the value for none of the cost.

### 10.4 What gets recorded, and what leaves the device

Engine: `bench/telemetry.ts` (collectors, all feature-detected), `bench/microbench.ts` (clock, bandwidth, and CPU probes), and allocation accounting in `gpu/context.ts`.

```ts
interface Telemetry {
  pressure?: { source: 'cpu'; timeline: { tMs: number; state: 'nominal' | 'fair' | 'serious' | 'critical' }[] };
  clockProbe: { tMs: number; relSpeed: number }[];   // 1.0 = after warm-up
  bandwidthGBps?: number;
  repeatDrift: Record<string, number>;               // per test id
  cpuProbe?: { before: number; after: number };
  memory: { deviceMemoryGiB?: number; pageBytes?: { afterLoad: number; end: number };
            gpuAllocatedPeakBytes: Record<string, number>; storageQuotaBytes?: number };
  display: { refreshHzEstimate: number; dpr: number; screen: [number, number]; hdr: boolean };
  power?: { charging: boolean; level: number };
  mainThread?: { longFrames: number; longestMs: number };
  timer: { crossOriginIsolated: boolean; resolutionUs: number };
  errors: { deviceLost?: { reason: string; message: string }; uncaptured: number; oom: boolean };
  lab?: { adapterExtras: Record<string, unknown> };  // developer-features fields, lab only
  external?: { kind: 'nvidia-smi' | 'hwinfo' | 'afterburner' | 'powermetrics' | 'other';
               series: Record<string, [tMs: number, value: number][]> };   // user-supplied
}
```

Privacy follows the README's "minimal device metadata" rule:

- **Local results keep everything.** A **submitted** result carries summaries only:
  - pressure as percent of time in each state,
  - minimum clock-probe speed,
  - bandwidth rounded to 10 GB/s,
  - page memory rounded to 10 MB.
- Raw timelines and imported logs are sent only if the user attaches them.
- Combined, these signals sharpen a fingerprint, so the submit screen lists every field before sending (§9.5). The server never joins results across `clientId`s.

---

## 11. Testing and QA

- **CI** (GitHub Actions): `tsc --noEmit`, unit tests, build, and the workload-hash check (fail if shaders or presets changed without a version bump after the freeze).
- **Unit tests (Vitest):** stats (median, percentiles, CV), score formula, camera-path interpolation, PRNG stability, schema round-trip, GPU-string normalization.
- **Browser smoke test (Playwright):** headless Chromium with WebGPU (SwiftShader) runs Light tier with a shortened timeline end to end, checks that a valid `RunResult` comes out, and compares probe hashes against the SwiftShader reference. This catches "the shader silently broke" regressions.
- **Device matrix** (shared responsibility; each teammate covers their own devices). At least: Windows + NVIDIA dGPU, Windows + AMD or Intel, macOS Apple silicon (Chrome and Safari), a laptop on battery vs. plugged in, Android (Chrome), iPhone/iPad (Safari). Record browser versions; the matrix becomes the "supported OS/browser pairs" list. Run matrix devices in **lab mode** with a hardware logger ([§10.3](#103-opt-in-ground-truth)) so every repeatability run has real temperature and clock data next to it.
- **Telemetry checks:** unit tests for summarization and rounding. A Playwright pass in Firefox and WebKit confirms every Chromium-only collector degrades to `undefined` without throwing. In the lab, compare clock-probe drops against logged clocks to calibrate the §10.2 cut-off values.
- **Repeatability study:** 5 consecutive ranked runs per device. Targets: graphics-score CV ≤ 2% on desktop dGPUs, ≤ 5% on laptops and phones (thermal). Publish the numbers either way.

---

## 12. Schedule and owners

Owners follow the README's division of work. Integration, reviews, and device testing are shared.

| Workstream | Owner | Scope in this plan |
| --- | --- | --- |
| Benchmark runner and metrics | **Charles** | §3: driver, timeline, protocol, stats, scoring, environment and flags, probes (with Yiding), export, repeatability study. §10: telemetry collectors, repeat drift, lab-mode protocol |
| Frontend and UX | **Eric** | §8: app shell, run flow, results, history, custom panel, leaderboard UI, charts. §10: cool-down screen, telemetry panel on results |
| API, storage, leaderboard | **Michael** | §9: schema, backend, hosting and headers, IndexedDB storage layer, validation, moderation, CI. §10: telemetry summarization, crash-report endpoint |
| Scenes, effects, user research | **Stan** | §7, camera paths and recorder, GT2 content (VAT crowd, SSAO, bloom with Yiding), user interviews and usability test |
| WebGPU renderer and GPU algorithms | **Yiding** | §6: context refactor, offscreen and present, PBR, G-buffer, clustering rewrite, shadows, GT2 GPU-driven pipeline, timestamps. §10: allocation accounting, OOM handling, clock and bandwidth probe kernels |

### Weekly plan

**Week 1, Oct 26 – Nov 1: Foundations and spikes**
- Everyone: review this plan and settle the [open decisions](#15-open-decisions).
- Yiding: `GpuContext` refactor, loop decoupling, offscreen targets + present blit (all done). Fix the 5 `tsc` errors.
- Charles: **throughput-loop spike on ≥3 browser/device pairs** (go/no-go for §3.1). Seeded PRNG, timeline clock.
- Eric: app shell, routing, wireframes for run and results pages.
- Michael: `shared/` schema v0, backend skeleton deployed with COOP/COEP headers, CI with type-check.
- Stan: camera-path recorder in Explore mode, spline playback, asset pipeline script. Book 3 interviews.

**Week 2, Nov 2 – 8: Measurement core**
- Charles: driver with warm-up, repeats, stats, flags, environment detection. JSON/CSV export. First telemetry collectors: Compute Pressure, refresh-rate and timer self-test, battery, wake lock, device memory.
- Yiding: sRGB, mipmaps, HDR + tonemap, PBR + normal maps (all done). Light count and radius as runtime values. Timestamp diagnostics. GPU allocation accounting and OOM error scopes in `GpuContext`.
- Eric: pre-flight, loading, running, and results pages wired to the engine.
- Michael: IndexedDB history store, `POST`/`GET` results endpoints, D1 tables.
- Stan: GT1 camera path authored. Interviews 1–2. Bake the VAT crowd clip.

**Week 3, Nov 9 – 15: Alpha (Fri Nov 13)**
- Yiding: clustering rewrite, G-buffer rework, cascaded shadows.
- Charles: scoring, probe frames + hashing, GPU-string normalization (with Michael). Repeat drift, UA Client Hints, page-memory and long-animation-frame collectors.
- Yiding: GPU clock and bandwidth probe kernels (with Charles for the scheduling between repeats).
- Eric: history + compare, custom settings panel. Pre-flight cool-down screen.
- Michael: leaderboard aggregation endpoint, Turnstile, rate limiting. `Telemetry` in the schema, plus summarization for submission.
- Stan + Yiding: instanced VAT crowd rendering. Interview 3.
- **Alpha exit criteria:** GT1 at three tiers runs end to end in Ranked and Custom. FPS exceeds the refresh rate on a fast dGPU. Results save to history and submit to the dev backend. Demo on two devices.

**Week 4, Nov 16 – 22: GT2 and leaderboard**
- Stan + Yiding: GT2 complete (compute culling, indirect draws, SSAO, bloom).
- Charles: run the repeatability protocol on the device matrix **in lab mode with hardware loggers**, and fix variance sources.
- Eric: leaderboard UI, percentile on results page, share links. Telemetry panel: a pressure-state band and clock-probe line under the FPS chart, plus memory and power context.
- Michael: server-side recompute, hash allow-list, plausibility checks, moderation tool. `Reporting-Endpoints` header and crash-report receiver.

**Week 5, Nov 23 – 29: Beta, calibration, freeze (Thanksgiving week)**
- Mon–Tue: tune tier parameters so each tier hits its target hardware. Pick `C_tier` from the reference device. Calibrate the telemetry warning cut-offs against the week-4 lab logs.
- **Wed Nov 25: workload freeze, suite v1.0.0, accepted hash published.** After this, only changes that don't touch rendering.
- Bug bash across the device matrix. Start the methodology doc (§3 is its skeleton).

**Week 6, Nov 30 – Dec 6: Release (Fri Dec 4)**
- Production deploy, leaderboard opened.
- Repeatability report, usability test with the interviewees, methodology published, demo video, final presentation.

### If we fall behind, cut in this order

1. Bandwidth and CPU probes, network hints, and the crash-report endpoint. Keep Compute Pressure, the clock probe, and repeat drift.
2. GT2's SSAO/bloom (keep the crowd).
3. Cascaded shadows (single cascade).
4. Probe-hash validation (keep server recompute and plausibility).
5. Extreme tier.
6. GT2 entirely (ship GT1-only suite v1; the score formula already handles one test).

The measurement core (§3), results and history, and submission are **not** on the cut list. Without them it isn't a benchmark.

---

## 13. Roadmap after December

- **Stress test:** 20 loops of GT1, frame-rate stability %, pass/fail at 97%. The thermal timeline chart comes from Compute Pressure plus a clock probe between loops, with imported sensor logs overlaid when present.
- **Sensor-log import** ([§10.3](#103-opt-in-ground-truth)): parsers for nvidia-smi, HWiNFO, Afterburner, and powermetrics, aligned to the run timeline and charted on the results page.
- **Native sensor helper:** evaluate only if log import proves popular. It stays strictly optional.
- **Feature tests:** draw-call throughput (API overhead equivalent), compute bandwidth, and a lighting-technique comparison. That one would bring the naive and Forward+ renderers back from git history.
- **CPU test:** WASM physics across Web Workers, with a combined score like 3DMark's overall score.
- **New suites:** an outdoor scene, a compute path-tracing test (BVH in compute; the "Port Royal" of the web), and a mobile-first suite.
- **Accounts and sync** for cross-device history. Hall of Fame. Per-GPU detail pages.
- **Bring your own glTF** in Explore mode, for the 3D-artist audience.
- **Demo mode** with music.
- **Stretch from the README:** diffusion image-generation benchmark (WebGPU inference via ONNX Runtime Web), scored as images/minute at a fixed model, resolution, and step count.

---

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A browser still ties offscreen submission to the display | Medium | High | Week-1 spike. Fallback: heavier tiers plus a `display-limited` flag. |
| Timer coarsening without isolation | Medium | Medium | COOP/COEP via host headers. Throughput over 30 s is robust anyway. |
| GPU model can't be identified | High | Medium | Multi-source detection, normalization table, self-reported grouping. |
| Thermal throttling makes laptops and phones noisy | High | Medium | Warm-up, repeats, CV flag. Publish per-class CV targets. Stress test in spring. |
| Clustering or VAT approach fails on mobile limits | Medium | High | Light tier tested on default limits from week 3. Keep a mobile device in the matrix. |
| Asset download too slow on first run | Medium | Medium | Asset pipeline, Cache Storage, size shown up front. |
| Scope vs. 6 weeks, plus Thanksgiving | High | High | Cut list (§12). Freeze date is fixed; features move, the freeze doesn't. |
| Leaderboard abuse | Medium | Medium | Recompute, hash allow-list, probe hashes, Turnstile, moderation. Honest limits in methodology. |
| Most telemetry APIs are Chromium-only, so results carry uneven context | High | Low | Every collector is optional and shows "not available in this browser". The score and ranking never depend on telemetry. Our own probes cover every browser. |
| Telemetry adds fingerprinting surface, or looks like it does | Medium | Medium | Summaries only on submit, the field list shown before sending, no joins across clients, and a privacy section in the methodology. |
| Compute Pressure semantics change, or it's never shipped outside Chromium | Medium | Low | Treat it as a hint. Warnings only. Feature-detect `knownSources` at runtime. |
| Browser or driver updates shift scores | High | Low | Record browser version; the leaderboard filters by it. Scores are tied to the suite version, not frozen across browsers. |

---

## 15. Open decisions

Decide these in week 1. The recommendation is listed first.

1. **Timeline model.** Fixed-duration, 3DMark style (recommended, §3.3), vs. fixed frame count (identical frames, but slow devices take minutes).
2. **Backend and hosting.** Cloudflare Pages + Workers + D1 (recommended) vs. Supabase + a header-capable static host.
3. **UI framework.** React (recommended) vs. Svelte or Preact. Eric's call.
4. **Reference device** for `C_tier` calibration, and its target score.
5. **Crowd asset source** and license.
6. **Fullscreen** required for ranked runs (recommended: required on desktop, best-effort on mobile).
7. **Production domain.** Point `renderrank.tonyxtian.com` at the production host and stop exposing the Vite dev server.
8. **Microbenchmark numbers in submissions.** Submit rounded bandwidth and minimum clock-probe speed (recommended: they help identify GPUs) vs. local-only.
9. **Crash reports.** Enable the `Reporting-Endpoints` crash receiver (recommended, aggregate-only) vs. skip it.
10. **Native sensor helper.** Defer and revisit after log import ships (recommended) vs. build in spring.
