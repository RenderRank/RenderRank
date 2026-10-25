import { Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { GpuContext } from './gpu/context';

export const fovYDegrees = 45;

export const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 32,
    attributes: [
        { // pos
            format: "float32x3",
            offset: 0,
            shaderLocation: 0
        },
        { // nor
            format: "float32x3",
            offset: 12,
            shaderLocation: 1
        },
        { // uv
            format: "float32x2",
            offset: 24,
            shaderLocation: 2
        }
    ]
};

let frameTimeCallback: ((frameTime: number) => void) | null = null;

export function setFrameTimeCallback(callback: ((frameTime: number) => void) | null) {
    frameTimeCallback = callback;
}

export abstract class Renderer {
    protected gpu: GpuContext;
    protected scene: Scene;
    protected lights: Lights;
    protected camera: Camera;

    protected stats: Stats;

    private prevTime: number = 0;
    private prevFrameTime: number = 0;
    private frameRequestId: number;

    constructor(stage: Stage) {
        this.gpu = stage.gpu;
        this.scene = stage.scene;
        this.lights = stage.lights;
        this.camera = stage.camera;
        this.stats = stage.stats;

        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }

    stop(): void {
        cancelAnimationFrame(this.frameRequestId);
    }

    protected abstract draw(): void;

    // CHECKITOUT: this is the main rendering loop
    private onFrame(time: number) {
        if (this.prevTime == 0) {
            this.prevTime = time;
            this.prevFrameTime = time;
        }

        let deltaTime = time - this.prevTime;
        this.camera.onFrame(deltaTime);
        this.lights.onFrame(time);

        this.stats.begin();

        this.draw();

        this.stats.end();

        // Calculate actual frame time (time between frames)
        const frameTime = time - this.prevFrameTime;

        // Call frame time callback if registered
        if (frameTimeCallback && this.prevFrameTime !== 0) {
            frameTimeCallback(frameTime);
        }

        this.prevTime = time;
        this.prevFrameTime = time;
        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }
}
