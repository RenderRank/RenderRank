import { GpuContext } from '../gpu/context';
import { PresentPass } from '../passes/present';
import { OrreryRenderer } from '../renderers/orrery';
import { renderResolutions } from '../simulations';
import type { SimulationSession } from '../simulation';
import { runThroughput } from '../testing/throughput';
import { orreryTimeline } from './orrery_timeline';

// Runs the Orrery on its fixed timeline, advanced in real time.
//
// Preview is a requestAnimationFrame loop that repeats the timeline. It is paced by the display.
//
// A benchmark or stress test plays the timeline in the shared throughput loop (src/testing/throughput.ts), uncapped.
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
                stop();
                benchmarkRunning = true;
                try {
                    return await runThroughput({
                        device: gpu.device,
                        timeline: orreryTimeline,
                        submitFrame,
                        gpuTimeMs: () => renderer.gpuTimeMs,
                        isLost: () => deviceLost,
                    }, {
                        signal,
                        progress,
                        loops,
                        metrics: (fps, frameTime, gpuTime) => metrics(fps, frameTime, gpuTime),
                        sample: frameTime => sample?.(frameTime),
                    });
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
