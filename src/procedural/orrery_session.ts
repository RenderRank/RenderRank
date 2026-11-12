import { GpuContext } from '../gpu/context';
import { PresentPass } from '../passes/present';
import { OrreryRenderer } from '../renderers/orrery';
import { renderResolutions, stabilityPassMark } from '../simulations';
import type { SimulationSession } from '../simulation';
import type { BenchmarkResult, BenchmarkRun, StressResult } from '../testing/benchmark';
import { cameraAt, shots, timelineDuration } from './orrery_timeline';

const warmupFrames = 30;

// Frames allowed on the GPU queue at once during a benchmark. Two keeps the GPU busy without letting work pile up.
const maxFramesInFlight = 2;

// Score = this constant x the harmonic mean of the four shots' frame rates
const scorePerFps = 100;

interface ShotSamples {
    frames: number;
    windows: number[]; // average frame time (ms) of each quarter-second window
    gpuTimes: number[];
}

// Runs the Orrery on its fixed timeline, advanced in real time.
//
// Preview is a requestAnimationFrame loop that repeats the timeline. It is paced by the display.
//
// A benchmark plays the timeline once in a throughput loop instead: frames render offscreen back to back, each
// submitted as soon as the GPU has room, so the frame rate isn't capped by the refresh rate. The canvas only gets a
// copy of the latest frame when the display asks for one. Faster GPUs render more frames of the same 40 seconds.
//
// A stress test plays the timeline several times back to back after a single warm-up, with no pause between loops,
// and reports how much the loops' frame rates differ.
export async function createOrrerySession(canvas: HTMLCanvasElement, onLost: (message: string) => void): Promise<SimulationSession> {
    const gpu = await GpuContext.create(canvas);
    let frameRequestId = 0;
    let deviceLost = false;
    gpu.lost.then(info => {
        deviceLost = true;
        cancelAnimationFrame(frameRequestId);
        if (info.reason !== 'destroyed') onLost(`The GPU connection was lost (${info.message || info.reason}). Reload the page to try again.`);
    });

    try {
        let resolution = renderResolutions['1080p'];
        let renderer = new OrreryRenderer(gpu, resolution);
        let presentPass = new PresentPass(gpu, renderer.outputTexture);

        let metrics: (fps: number, frameTime: number, gpuTime?: number) => void = () => {};
        let sample: ((frameTime: number) => void) | null = null;
        let benchmarkRunning = false;

        // Submits one frame at timeline time t, optionally with a copy to the canvas
        const submitFrame = (t: number, present: boolean) => {
            renderer.setTime(t);
            const encoder = gpu.device.createCommandEncoder();
            renderer.encodeFrame(encoder);
            if (present) presentPass.encode(encoder);
            gpu.device.queue.submit([encoder.finish()]);
            renderer.afterSubmit();
        };

        // Preview loop state. timelineStart is the rAF timestamp that maps to t = 0.
        let timelineStart: number | undefined;
        let prevTime = 0;
        let elapsed = 0;
        let frames = 0;

        const onPreviewFrame = (time: number) => {
            timelineStart ??= time;
            submitFrame((time - timelineStart) / 1000, true);

            if (prevTime !== 0) {
                sample?.(time - prevTime);
                elapsed += time - prevTime;
                frames++;
                if (elapsed >= 500) {
                    metrics(1000 * frames / elapsed, elapsed / frames, renderer.gpuTimeMs);
                    elapsed = frames = 0;
                }
            }
            prevTime = time;
            frameRequestId = requestAnimationFrame(onPreviewFrame);
        };

        const stop = () => cancelAnimationFrame(frameRequestId);

        const runThroughput = async (signal: AbortSignal, progress: (message: string) => void, loops: number): Promise<BenchmarkRun> => {
            const loopSamples: ShotSamples[][] = [];
            const checkAbort = () => {
                if (signal.aborted || deviceLost) throw new DOMException('Benchmark stopped', 'AbortError');
            };

            // The display only asks for a new image; it never paces the work
            let presentRequested = true;
            const requestPresent = () => {
                presentRequested = true;
                frameRequestId = requestAnimationFrame(requestPresent);
            };
            stop();
            frameRequestId = requestAnimationFrame(requestPresent);

            // A hidden tab is throttled by the browser, so its numbers mean nothing
            let wasHidden = document.hidden;
            const onVisibility = () => { wasHidden ||= document.hidden; };
            document.addEventListener('visibilitychange', onVisibility);

            try {
                progress('Warming up…');
                for (let i = 0; i < warmupFrames; i++) {
                    checkAbort();
                    submitFrame(0, presentRequested);
                    presentRequested = false;
                    await gpu.device.queue.onSubmittedWorkDone();
                }

                const pending: Promise<void>[] = [];
                const runStart = performance.now();
                // Completion callbacks arrive in bursts, so single intervals are noise. Quarter-second windows give
                // a usable best and worst frame time per shot.
                let spreadStart = runStart;
                let spreadFrames = 0;
                let spreadShot = -1;
                let windowStart = runStart;
                let windowFrames = 0;
                let sampleStart = runStart;
                let sampleFrames = 0;

                // Frames still in flight when a loop ends count toward that loop, as the last frames of a single
                // run do. The next loop starts submitting right away, so the GPU never idles between loops.
                for (let loop = 0; loop < loops; loop++) {
                    const samples: ShotSamples[] = shots.map(() => ({ frames: 0, windows: [], gpuTimes: [] }));
                    loopSamples.push(samples);
                    const loopLabel = loops > 1 ? `Loop ${loop + 1} of ${loops} · ` : '';
                    const start = performance.now();
                    let reportedShot = -1;

                    while (true) {
                        checkAbort();
                        const t = (performance.now() - start) / 1000;
                        if (t >= timelineDuration) break;

                        const shotIndex = cameraAt(t).shotIndex;
                        if (shotIndex !== reportedShot) {
                            reportedShot = shotIndex;
                            progress(`${loopLabel}Shot ${shotIndex + 1} of ${shots.length} · ${shots[shotIndex].name}`);
                        }

                        submitFrame(t, presentRequested);
                        presentRequested = false;

                        pending.push(gpu.device.queue.onSubmittedWorkDone().then(() => {
                            const now = performance.now();
                            const shot = samples[shotIndex];
                            shot.frames++;
                            if (renderer.gpuTimeMs !== undefined) shot.gpuTimes.push(renderer.gpuTimeMs);

                            if (spreadShot !== shotIndex) { // a window never spans a cut
                                spreadShot = shotIndex;
                                spreadStart = now;
                                spreadFrames = 0;
                            } else {
                                spreadFrames++;
                                if (now - spreadStart >= 250) {
                                    shot.windows.push((now - spreadStart) / spreadFrames);
                                    spreadStart = now;
                                    spreadFrames = 0;
                                }
                            }

                            // Graph samples: 50 ms windows smooth out the bursts completion callbacks arrive in
                            sampleFrames++;
                            if (now - sampleStart >= 50) {
                                sample?.((now - sampleStart) / sampleFrames);
                                sampleStart = now;
                                sampleFrames = 0;
                            }

                            windowFrames++;
                            if (now - windowStart >= 500) {
                                metrics(1000 * windowFrames / (now - windowStart), (now - windowStart) / windowFrames, renderer.gpuTimeMs);
                                windowStart = now;
                                windowFrames = 0;
                            }
                        }));
                        if (pending.length >= maxFramesInFlight) await pending.shift();
                    }
                }
                await Promise.all(pending);
                checkAbort();
            } finally {
                stop();
                document.removeEventListener('visibilitychange', onVisibility);
            }

            // Each shot's rate is frames finished over the shot's fixed length. Harmonic mean: every shot lasts the
            // same time, so this weighs them equally and a slow shot can't hide behind a fast one. It is zero if any
            // shot finished no frames.
            const harmonicFps = (samples: ShotSamples[]) => {
                const shotFps = samples.map((shot, i) => shot.frames / shots[i].duration);
                return shotFps.every(fps => fps > 0) ? shots.length / shotFps.reduce((sum, fps) => sum + 1 / fps, 0) : 0;
            };
            const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
            const row = (label: string, fps: number, samples: ShotSamples[]): BenchmarkResult => {
                const windows = samples.flatMap(shot => shot.windows);
                const gpuTimes = samples.flatMap(shot => shot.gpuTimes);
                return {
                    label,
                    avgFrameTimeMs: fps > 0 ? 1000 / fps : Infinity,
                    minFrameTimeMs: windows.length > 0 ? Math.min(...windows) : NaN,
                    maxFrameTimeMs: windows.length > 0 ? Math.max(...windows) : NaN,
                    avgGpuTimeMs: gpuTimes.length > 0 ? average(gpuTimes) : undefined,
                };
            };
            const hiddenNote = 'Not valid: the tab was hidden during the run, so the browser throttled it.';
            const noFramesNote = 'Not valid: at least one shot finished no frames.';

            if (loops === 1) {
                const [samples] = loopSamples;
                const fps = harmonicFps(samples);
                const valid = !wasHidden && fps > 0;
                return {
                    rows: shots.map((shot, i) => row(shot.name, samples[i].frames / shot.duration, [samples[i]])),
                    score: {
                        value: Math.round(scorePerFps * fps),
                        averageFps: fps,
                        valid,
                        note: wasHidden ? hiddenNote : fps === 0 ? noFramesNote
                            : 'Rendered offscreen without a frame-rate cap. Compare scores only at the same resolution.',
                    },
                };
            }

            // A loop's average frame time is 1000 / its harmonic-mean frame rate, which is the mean of its shots'
            // average frame times, so it matches the loop's score
            const loopFps = loopSamples.map(harmonicFps);
            const best = Math.max(...loopFps);
            const worst = Math.min(...loopFps);
            const stability = best > 0 ? worst / best : 0;
            const valid = !wasHidden && worst > 0;
            const stress: StressResult = {
                loops,
                loopScores: loopFps.map(fps => Math.round(scorePerFps * fps)),
                stability,
                threshold: stabilityPassMark,
                passed: valid && stability >= stabilityPassMark,
                valid,
                note: wasHidden ? hiddenNote : worst === 0 ? noFramesNote
                    : `The lowest loop score as a percentage of the highest, over ${loops} loops. A run passes at ${stabilityPassMark * 100}% or more.`,
            };
            return { rows: loopSamples.map((samples, i) => row(`Loop ${i + 1}`, loopFps[i], samples)), stress };
        };

        return {
            configure(name) {
                if (renderResolutions[name] !== resolution) {
                    resolution = renderResolutions[name];
                    const previous = renderer;
                    renderer = new OrreryRenderer(gpu, resolution);
                    presentPass = new PresentPass(gpu, renderer.outputTexture);
                    previous.destroy();
                }
            },
            start() {
                stop();
                timelineStart = undefined;
                prevTime = 0;
                elapsed = frames = 0;
                frameRequestId = requestAnimationFrame(onPreviewFrame);
            },
            stop,
            destroy() { stop(); renderer.destroy(); gpu.destroy(); },
            setMetricsCallback(callback) { metrics = callback; },
            setSampleCallback(callback) { sample = callback; },
            async benchmark(signal, progress, loops = 1) {
                benchmarkRunning = true;
                try {
                    return await runThroughput(signal, progress, loops);
                } finally {
                    benchmarkRunning = false;
                }
            },
            isBenchmarkRunning() { return benchmarkRunning; },
        };
    } catch (error) {
        gpu.destroy();
        throw error;
    }
}
