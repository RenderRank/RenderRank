// The benchmark procedure every scored test shares: play a fixed timeline in a throughput loop, and score it.
//
// Frames render offscreen back to back, each submitted as soon as the GPU has room, so the frame rate isn't capped by
// the refresh rate. The canvas only gets a copy of the latest frame when the display asks for one. Faster GPUs render
// more frames of the same timeline. A stress test plays the timeline several times back to back after a single
// warm-up, with no pause between loops, and reports how much the loops' frame rates differ.
import { stabilityPassMark } from '../simulations';
import type { Timeline } from '../timeline';
import type { BenchmarkResult, BenchmarkRun, StressResult } from './benchmark';

const warmupFrames = 30;

// Frames allowed on the GPU queue at once. Two keeps the GPU busy without letting work pile up.
const maxFramesInFlight = 2;

// Score = this constant x the harmonic mean of the shots' frame rates
const scorePerFps = 100;

// What the loop drives: a scene that can render any moment of its timeline
export interface ThroughputScene {
    device: GPUDevice;
    timeline: Timeline;
    // Encodes and submits the frame at timeline time t (seconds), copying it to the canvas when `present` is set
    submitFrame(t: number, present: boolean): void;
    // GPU time of the scene's timed passes in the latest measured frame, when timestamp queries are available
    gpuTimeMs(): number | undefined;
    isLost(): boolean;
}

export interface ThroughputOptions {
    signal: AbortSignal;
    progress: (message: string) => void;
    loops: number;
    // Live readouts: frame rate and frame time every half second, and graph samples in 50 ms windows
    metrics: (fps: number, frameTime: number, gpuTime?: number) => void;
    sample: (frameTime: number) => void;
}

interface ShotSamples {
    frames: number;
    windows: number[]; // average frame time (ms) of each quarter-second window
    gpuTimes: number[];
}

export async function runThroughput(scene: ThroughputScene, options: ThroughputOptions): Promise<BenchmarkRun> {
    const { device, timeline } = scene;
    const { signal, progress, loops, metrics, sample } = options;
    const { shots } = timeline;
    const loopSamples: ShotSamples[][] = [];
    const checkAbort = () => {
        if (signal.aborted || scene.isLost()) throw new DOMException('Benchmark stopped', 'AbortError');
    };

    // The display only asks for a new image; it never paces the work
    let presentRequested = true;
    let presentRequestId = 0;
    const requestPresent = () => {
        presentRequested = true;
        presentRequestId = requestAnimationFrame(requestPresent);
    };
    presentRequestId = requestAnimationFrame(requestPresent);

    // A hidden tab is throttled by the browser, so its numbers mean nothing
    let wasHidden = document.hidden;
    const onVisibility = () => { wasHidden ||= document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);

    try {
        progress('Warming up…');
        for (let i = 0; i < warmupFrames; i++) {
            checkAbort();
            scene.submitFrame(0, presentRequested);
            presentRequested = false;
            await device.queue.onSubmittedWorkDone();
        }

        const pending: Promise<void>[] = [];
        const runStart = performance.now();
        // Completion callbacks arrive in bursts, so single intervals are noise. Quarter-second windows give a usable
        // best and worst frame time per shot.
        let spreadStart = runStart;
        let spreadFrames = 0;
        let spreadShot = -1;
        let windowStart = runStart;
        let windowFrames = 0;
        let sampleStart = runStart;
        let sampleFrames = 0;

        // Frames still in flight when a loop ends count toward that loop, as the last frames of a single run do. The
        // next loop starts submitting right away, so the GPU never idles between loops.
        for (let loop = 0; loop < loops; loop++) {
            const samples: ShotSamples[] = shots.map(() => ({ frames: 0, windows: [], gpuTimes: [] }));
            loopSamples.push(samples);
            const loopLabel = loops > 1 ? `Loop ${loop + 1} of ${loops} · ` : '';
            const start = performance.now();
            let reportedShot = -1;

            while (true) {
                checkAbort();
                const t = (performance.now() - start) / 1000;
                if (t >= timeline.duration) break;

                const shotIndex = timeline.cameraAt(t).shotIndex;
                if (shotIndex !== reportedShot) {
                    reportedShot = shotIndex;
                    progress(`${loopLabel}Shot ${shotIndex + 1} of ${shots.length} · ${shots[shotIndex].name}`);
                }

                scene.submitFrame(t, presentRequested);
                presentRequested = false;

                pending.push(device.queue.onSubmittedWorkDone().then(() => {
                    const now = performance.now();
                    const shot = samples[shotIndex];
                    const gpuTime = scene.gpuTimeMs();
                    shot.frames++;
                    if (gpuTime !== undefined) shot.gpuTimes.push(gpuTime);

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
                        sample((now - sampleStart) / sampleFrames);
                        sampleStart = now;
                        sampleFrames = 0;
                    }

                    windowFrames++;
                    if (now - windowStart >= 500) {
                        metrics(1000 * windowFrames / (now - windowStart), (now - windowStart) / windowFrames, gpuTime);
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
        cancelAnimationFrame(presentRequestId);
        document.removeEventListener('visibilitychange', onVisibility);
    }

    // Each shot's rate is frames finished over the shot's fixed length. Harmonic mean: every shot lasts the same time,
    // so this weighs them equally and a slow shot can't hide behind a fast one. It is zero if any shot finished no
    // frames.
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

    // A loop's average frame time is 1000 / its harmonic-mean frame rate, which is the mean of its shots' average
    // frame times, so it matches the loop's score
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
}
