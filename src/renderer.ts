import { Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { GpuContext } from './gpu/context';

export const fovYDegrees = 45;

export interface Resolution {
    width: number;
    height: number;
}

export const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 48,
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
        },
        { // tangent (w is the bitangent sign)
            format: "float32x4",
            offset: 32,
            shaderLocation: 3
        }
    ]
};

// A rendering technique. It renders into its own offscreen targets at the stage's fixed resolution and never touches
// the canvas; a driver decides when frames run and when they're presented.
export abstract class Renderer {
    protected gpu: GpuContext;
    protected resolution: Resolution;
    protected scene: Scene;
    protected lights: Lights;
    protected camera: Camera;

    // The finished frame: tonemapped and sRGB-encoded, at the stage's resolution
    abstract readonly outputTexture: GPUTexture;

    constructor(stage: Stage) {
        this.gpu = stage.gpu;
        this.resolution = stage.resolution;
        this.scene = stage.scene;
        this.lights = stage.lights;
        this.camera = stage.camera;
    }

    // Records every pass of one frame into the encoder. The caller submits it.
    abstract encodeFrame(encoder: GPUCommandEncoder): void;

    // Frees the renderer's GPU targets. It can't render afterwards; frames already submitted still finish.
    abstract destroy(): void;
}
