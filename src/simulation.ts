import Stats from 'stats.js';
import { GpuContext } from './gpu/context';
import { ClusteredDeferredRenderer } from './renderers/clustered_deferred';
import { DisplayDriver } from './drivers/display_driver';
import { setupLoaders, Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { BenchmarkRunner } from './testing/benchmark';
import type { BenchmarkResult, BenchmarkRun } from './testing/benchmark';
import { renderResolutions } from './simulations';
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
    benchmark(signal: AbortSignal, progress: (message: string) => void): Promise<BenchmarkRun>;
    isBenchmarkRunning(): boolean;
}

export async function createSimulation(canvas: HTMLCanvasElement, simulation: Simulation, onLost: (message: string) => void): Promise<SimulationSession> {
    if (simulation.kind === 'procedural') {
        return (await import('./procedural/orrery_session')).createOrrerySession(canvas, onLost);
    }
    return createGltfSimulation(canvas, simulation, onLost);
}

async function createGltfSimulation(canvas: HTMLCanvasElement, simulation: GltfSimulation, onLost: (message: string) => void): Promise<SimulationSession> {
    const gpu = await GpuContext.create(canvas);
    let driver: DisplayDriver | undefined;
    gpu.lost.then(info => {
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
        const display = new DisplayDriver(stage, renderer);
        driver = display;
        const runner = new BenchmarkRunner(stage, display);
        let metrics: (fps: number, frameTime: number) => void = () => {};
        let elapsed = 0;
        let frames = 0;
        const reportFrame = (frameTime: number) => {
            elapsed += frameTime;
            frames++;
            if (elapsed >= 500) {
                metrics(1000 * frames / elapsed, elapsed / frames);
                elapsed = frames = 0;
            }
        };
        // An observer rather than the frame-time callback, which the benchmark runner takes over while it runs
        let sample: ((frameTime: number) => void) | null = null;
        display.setFrameObserver(frameTime => { reportFrame(frameTime); sample?.(frameTime); });
        return {
            configure(name, count) {
                const resolution = renderResolutions[name];
                if (stage.resolution !== resolution) {
                    stage.setResolution(resolution);
                    const previous = renderer;
                    renderer = new ClusteredDeferredRenderer(stage);
                    display.setRenderer(renderer);
                    previous.destroy();
                }
                lights.numLights = count;
                lights.updateLightSetUniformNumLights();
            },
            start(interactive) {
                camera.inputEnabled = interactive;
                camera.keys = {};
                camera.cameraPos.set(simulation.camera.position);
                camera.resetOrientation(simulation.camera.yaw, simulation.camera.pitch);
                elapsed = frames = 0;
                display.start();
            },
            stop() { camera.inputEnabled = false; camera.keys = {}; display.stop(); },
            destroy() { display.stop(); camera.destroy(); renderer.destroy(); gpu.destroy(); },
            setMetricsCallback(callback) { metrics = callback; },
            setSampleCallback(callback) { sample = callback; },
            async benchmark(signal, progress) {
                let captured: BenchmarkResult[] = [];
                runner.setProgressCallback(progress);
                runner.setCompleteCallback(results => { captured = results; });
                await runner.runBenchmark(signal);
                return { rows: captured };
            },
            isBenchmarkRunning() { return runner.isTestRunning(); },
        };
    } catch (error) {
        gpu.destroy();
        throw error;
    }
}
