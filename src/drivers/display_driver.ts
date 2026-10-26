import { Renderer } from '../renderer';
import { Stage } from '../stage/stage';
import { PresentPass } from '../passes/present';

// Renders one frame per requestAnimationFrame and presents each to the canvas. The display paces it, so it can't go
// faster than the refresh rate: it's for interactive viewing, never for scores.
export class DisplayDriver {
    private stage: Stage;
    private renderer: Renderer;
    private presentPass: PresentPass;

    private prevTime: number = 0;
    private frameRequestId: number = 0;
    private frameTimeCallback: ((frameTime: number) => void) | null = null;

    constructor(stage: Stage, renderer: Renderer) {
        this.stage = stage;
        this.renderer = renderer;
        this.presentPass = new PresentPass(stage.gpu, renderer.outputTexture);
    }

    start(): void {
        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }

    stop(): void {
        cancelAnimationFrame(this.frameRequestId);
    }

    // Takes effect on the next frame
    setRenderer(renderer: Renderer) {
        this.renderer = renderer;
        this.presentPass = new PresentPass(this.stage.gpu, renderer.outputTexture);
    }

    // Called after every frame except the first, with the time since the previous frame in ms
    setFrameTimeCallback(callback: ((frameTime: number) => void) | null) {
        this.frameTimeCallback = callback;
    }

    private onFrame(time: number) {
        const isFirstFrame = this.prevTime == 0;
        if (isFirstFrame) {
            this.prevTime = time;
        }

        const frameTime = time - this.prevTime;
        this.stage.camera.onFrame(frameTime);
        this.stage.lights.onFrame(time);

        this.stage.stats.begin();

        const device = this.stage.gpu.device;
        const encoder = device.createCommandEncoder();
        this.renderer.encodeFrame(encoder);
        this.presentPass.encode(encoder);
        device.queue.submit([encoder.finish()]);

        this.stage.stats.end();

        if (this.frameTimeCallback && !isFirstFrame) {
            this.frameTimeCallback(frameTime);
        }

        this.prevTime = time;
        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }
}
