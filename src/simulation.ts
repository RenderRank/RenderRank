import Stats from 'stats.js';
import { GpuContext } from './gpu/context';
import { ClusteredDeferredRenderer } from './renderers/clustered_deferred';
import { DisplayDriver } from './drivers/display_driver';
import { PresentPass } from './passes/present';
import { fovYDegrees } from './renderer';
import { setupLoaders, Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { sponzaTimeline } from './stage/sponza_timeline';
import type { BenchmarkRun } from './testing/benchmark';
import { runThroughput } from './testing/throughput';
import { renderResolutions, sponzaBenchmarkLights } from './simulations';
import type { GltfSimulation, Simulation } from './simulations';

export interface SimulationSession {
    configure(resolution: string, lights: number): void;
    start(interactive: boolean): void;
    stop(): void;
    destroy(): void;
    setMetricsCallback(callback: (fps: number, frameTime: number, gpuTime?: number) => void): void;
    // Frame times in ms as they happen, for graphs. One call per frame, or per short window when frames aren't
    // display-paced.
    setSampleCallback(callback: ((frameTime: number) => void) | null): void;
    // More than one loop runs a stress test. Only scenes with `stress` in their catalog entry support it.
    benchmark(signal: AbortSignal, progress: (message: string) => void, loops?: number): Promise<BenchmarkRun>;
    isBenchmarkRunning(): boolean;
}

export async function createSimulation(canvas: HTMLCanvasElement, simulation: Simulation, onLost: (message: string) => void): Promise<SimulationSession> {
    if (simulation.kind === 'procedural') {
        return (await import('./procedural/orrery_session')).createOrrerySession(canvas, onLost);
    }
    return createGltfSimulation(canvas, simulation, onLost);
}

// Sponza. Preview is display-paced with a free camera and the light slider. The benchmark plays the fixed timeline in
// src/stage/sponza_timeline.ts with a fixed light count, in the throughput loop the Orrery uses, so it is uncapped and
// scored the same way.
async function createGltfSimulation(canvas: HTMLCanvasElement, simulation: GltfSimulation, onLost: (message: string) => void): Promise<SimulationSession> {
    const gpu = await GpuContext.create(canvas);
    let driver: DisplayDriver | undefined;
    let deviceLost = false;
    gpu.lost.then(info => {
        deviceLost = true;
        driver?.stop();
        if (info.reason !== 'destroyed') onLost(`The GPU connection was lost (${info.message || info.reason}). Reload the page to try again.`);
    });
    try {
        setupLoaders();
        const scene = new Scene(gpu);
        await scene.loadGltf(simulation.source);
        const camera = new Camera(gpu, renderResolutions['1080p']);
        const lights = new Lights(gpu, camera);
        const stage = new Stage(gpu, renderResolutions['1080p'], scene, lights, camera, new Stats());
        let renderer = new ClusteredDeferredRenderer(stage);
        let presentPass = new PresentPass(gpu, renderer.outputTexture);
        const display = new DisplayDriver(stage, renderer);
        driver = display;
        let previewLights = lights.numLights;
        let benchmarkRunning = false;

        let metrics: (fps: number, frameTime: number, gpuTime?: number) => void = () => {};
        let elapsed = 0;
        let frames = 0;
        const reportFrame = (frameTime: number) => {
            elapsed += frameTime;
            frames++;
            if (elapsed >= 500) {
                metrics(1000 * frames / elapsed, elapsed / frames, renderer.gpuTimeMs);
                elapsed = frames = 0;
            }
        };
        let sample: ((frameTime: number) => void) | null = null;
        display.setFrameObserver(frameTime => { reportFrame(frameTime); sample?.(frameTime); });

        // One benchmark frame: camera and lights posed for timeline time t (seconds)
        const submitFrame = (t: number, present: boolean) => {
            const pose = sponzaTimeline.cameraAt(t);
            camera.setPose(pose.position, pose.target, pose.fovYDegrees);
            camera.onFrame(0);
            const encoder = gpu.device.createCommandEncoder();
            lights.encodeMove(encoder, t * 1000);
            renderer.encodeFrame(encoder);
            if (present) presentPass.encode(encoder);
            gpu.device.queue.submit([encoder.finish()]);
            renderer.afterSubmit();
        };

        return {
            configure(name, count) {
                const resolution = renderResolutions[name];
                if (stage.resolution !== resolution) {
                    stage.setResolution(resolution);
                    const previous = renderer;
                    renderer = new ClusteredDeferredRenderer(stage);
                    presentPass = new PresentPass(gpu, renderer.outputTexture);
                    display.setRenderer(renderer);
                    previous.destroy();
                }
                previewLights = count;
                lights.numLights = count;
                lights.updateLightSetUniformNumLights();
            },
            start(interactive) {
                camera.inputEnabled = interactive;
                camera.keys = {};
                camera.cameraPos.set(simulation.camera.position);
                camera.resetOrientation(simulation.camera.yaw, simulation.camera.pitch);
                camera.setFieldOfView(fovYDegrees);
                elapsed = frames = 0;
                display.start();
            },
            stop() { camera.inputEnabled = false; camera.keys = {}; display.stop(); },
            destroy() { display.stop(); camera.destroy(); renderer.destroy(); gpu.destroy(); },
            setMetricsCallback(callback) { metrics = callback; },
            setSampleCallback(callback) { sample = callback; },
            async benchmark(signal, progress, loops = 1): Promise<BenchmarkRun> {
                display.stop();
                camera.inputEnabled = false;
                camera.keys = {};
                benchmarkRunning = true;
                lights.numLights = sponzaBenchmarkLights;
                lights.updateLightSetUniformNumLights();
                try {
                    return await runThroughput({
                        device: gpu.device,
                        timeline: sponzaTimeline,
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
                    lights.numLights = previewLights;
                    lights.updateLightSetUniformNumLights();
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
