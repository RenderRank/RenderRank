import { GpuContext } from '../gpu/context';
import { Resolution } from '../renderer';
import * as shaders from '../shaders/shaders';
import { TonemapPass } from '../passes/tonemap';
import { PassTimer } from '../gpu/pass_timer';
import { mechanismAt, orreryTimeline } from '../procedural/orrery_timeline';
import type { Vec3 } from '../timeline';

function normalize(v: Vec3): Vec3 {
    const length = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// Renders the procedural Orrery scene: one full-screen ray-marching pass into an HDR target, then the shared tonemap.
// There is no scene data on the GPU beyond one small uniform buffer holding the camera and the mechanism's pose.
export class OrreryRenderer {
    private gpu: GpuContext;
    private resolution: Resolution;

    // Layout matches the Frame struct in orrery.fs.wgsl
    private uniforms = new Float32Array(76);
    private uniformsBuffer: GPUBuffer;

    private hdrTexture: GPUTexture;
    private hdrTextureView: GPUTextureView;

    private tonemapPass: TonemapPass;
    readonly outputTexture: GPUTexture;

    private bindGroup: GPUBindGroup;
    private pipeline: GPURenderPipeline;

    // Times the ray-marching pass
    private timer: PassTimer;
    get gpuTimeMs() { return this.timer.gpuTimeMs; }

    constructor(gpu: GpuContext, resolution: Resolution) {
        this.gpu = gpu;
        this.resolution = resolution;

        this.uniformsBuffer = gpu.device.createBuffer({
            label: "orrery uniforms",
            size: this.uniforms.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.hdrTexture = gpu.device.createTexture({
            label: "orrery HDR",
            size: [resolution.width, resolution.height],
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.hdrTextureView = this.hdrTexture.createView();

        this.tonemapPass = new TonemapPass(gpu, this.hdrTexture);
        this.outputTexture = this.tonemapPass.outputTexture;

        const bindGroupLayout = gpu.device.createBindGroupLayout({
            label: "orrery bind group layout",
            entries: [
                { // frame uniforms
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.bindGroup = gpu.device.createBindGroup({
            label: "orrery bind group",
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformsBuffer }
                }
            ]
        });

        this.pipeline = gpu.device.createRenderPipeline({
            label: "orrery pipeline",
            layout: gpu.device.createPipelineLayout({
                label: "orrery pipeline layout",
                bindGroupLayouts: [ bindGroupLayout ]
            }),
            vertex: {
                module: gpu.device.createShaderModule({
                    label: "orrery vert shader",
                    code: shaders.fullscreenVertSrc
                })
            },
            fragment: {
                module: gpu.device.createShaderModule({
                    label: "orrery frag shader",
                    code: shaders.orreryFragSrc
                }),
                targets: [
                    {
                        format: "rgba16float"
                    }
                ]
            }
        });

        this.timer = new PassTimer(gpu);
    }

    // Poses the camera and mechanism for timeline time t (seconds)
    setTime(t: number) {
        const camera = orreryTimeline.cameraAt(t);
        const forward = normalize([
            camera.target[0] - camera.position[0],
            camera.target[1] - camera.position[1],
            camera.target[2] - camera.position[2]
        ]);
        const right = normalize(cross(forward, [0, 1, 0]));
        const up = cross(right, forward);
        const tanHalfFov = Math.tan(camera.fovYDegrees * Math.PI / 360);

        const u = this.uniforms;
        u.set(camera.position, 0);
        u[3] = t;
        u.set(right, 4);
        u[7] = tanHalfFov;
        u.set(up, 8);
        u[11] = this.resolution.width / this.resolution.height;
        u.set(forward, 12);
        u[15] = 2 * tanHalfFov / this.resolution.height;

        // The shader wants world -> ring-local, the transpose of each rotation. WGSL matrices are column-major with
        // each vec3 column padded to 4 floats, so column j of the transpose is row j of the rotation.
        const mechanism = mechanismAt(t);
        mechanism.ringRotations.forEach((rotation, ring) => {
            rotation.forEach((row, j) => u.set(row, 16 + ring * 12 + j * 4));
        });
        mechanism.planets.forEach((planet, i) => {
            u.set(planet.center, 52 + i * 4);
            u[52 + i * 4 + 3] = planet.radius;
        });

        this.gpu.device.queue.writeBuffer(this.uniformsBuffer, 0, u);
    }

    // Records one frame into the encoder. The caller submits it, then calls afterSubmit().
    encodeFrame(encoder: GPUCommandEncoder) {
        const pass = encoder.beginRenderPass({
            label: "orrery ray-march pass",
            colorAttachments: [
                {
                    view: this.hdrTextureView,
                    clearValue: [0, 0, 0, 1],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            timestampWrites: this.timer.both
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(6);
        pass.end();

        this.timer.resolve(encoder);

        this.tonemapPass.encode(encoder);
    }

    afterSubmit() {
        this.timer.afterSubmit();
    }

    destroy() {
        this.hdrTexture.destroy();
        this.tonemapPass.destroy();
        this.uniformsBuffer.destroy();
        this.timer.destroy();
    }
}
