import { GpuContext } from "../gpu/context";
import { Camera } from "./camera";
import { Lights } from "./lights";
import { Scene } from "./scene";

export class Stage {
    gpu: GpuContext;
    scene: Scene;
    lights: Lights;
    camera: Camera;
    stats: Stats;

    constructor(gpu: GpuContext, scene: Scene, lights: Lights, camera: Camera, stats: Stats) {
        this.gpu = gpu;
        this.scene = scene;
        this.lights = lights;
        this.camera = camera;
        this.stats = stats;
    }
}
