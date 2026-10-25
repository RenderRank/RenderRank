import { GpuContext } from "../gpu/context";
import { Resolution } from "../renderer";
import { Camera } from "./camera";
import { Lights } from "./lights";
import { Scene } from "./scene";

export class Stage {
    gpu: GpuContext;
    resolution: Resolution; // fixed render resolution, independent of the canvas size
    scene: Scene;
    lights: Lights;
    camera: Camera;
    stats: Stats;

    constructor(gpu: GpuContext, resolution: Resolution, scene: Scene, lights: Lights, camera: Camera, stats: Stats) {
        this.gpu = gpu;
        this.resolution = resolution;
        this.scene = scene;
        this.lights = lights;
        this.camera = camera;
        this.stats = stats;
    }
}
