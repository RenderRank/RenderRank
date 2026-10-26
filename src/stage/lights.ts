import { vec3 } from "wgpu-matrix";
import { GpuContext } from "../gpu/context";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";

const numClusters = shaders.constants.clusterWidth * shaders.constants.clusterHeight * shaders.constants.clusterDepth;

export interface ClusteringStats {
    visibleLights: number;   // lights left after frustum culling
    lightIndices: number;    // cluster-light pairs requested, which can exceed the index list's capacity
    overflowed: boolean;     // some clusters dropped lights because the index list was full
}

// h in [0, 1]
function hueToRgb(h: number) {
    let f = (n: number, k = (n + h * 6) % 6) => 1 - Math.max(Math.min(k, 4 - k, 1), 0);
    return vec3.lerp(vec3.create(1, 1, 1), vec3.create(f(5), f(3), f(1)), 0.8);
}

export class Lights {
    private gpu: GpuContext;
    private camera: Camera;

    numLights = 500;
    static readonly maxNumLights = 5000;
    static readonly numFloatsPerLight = 8; // vec3f is aligned at 16 byte boundaries

    static readonly lightIntensity = 0.1;

    lightsArray = new Float32Array(Lights.maxNumLights * Lights.numFloatsPerLight);
    lightSetStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    moveLightsComputeBindGroupLayout: GPUBindGroupLayout;
    moveLightsComputeBindGroup: GPUBindGroup;
    moveLightsComputePipeline: GPUComputePipeline;

    // Clustering resources
    clusterAABBsBuffer: GPUBuffer;
    visibleLightsBuffer: GPUBuffer;
    lightGridBuffer: GPUBuffer;
    globalLightIndexListBuffer: GPUBuffer;
    clusteringCountersBuffer: GPUBuffer;

    // One layout and bind group shared by the three clustering pipelines; each shader declares the bindings it uses
    clusteringComputeBindGroupLayout: GPUBindGroupLayout;
    clusteringComputeBindGroup: GPUBindGroup;
    clusterBoundsComputePipeline: GPUComputePipeline;
    lightCullingComputePipeline: GPUComputePipeline;
    lightAssignmentComputePipeline: GPUComputePipeline;

    // The camera's projection and the render resolution are fixed once they exist, so bounds are computed on the first
    // clustering pass only
    private clusterBoundsDirty = true;

    constructor(gpu: GpuContext, camera: Camera) {
        this.gpu = gpu;
        this.camera = camera;

        this.lightSetStorageBuffer = this.gpu.device.createBuffer({
            label: "lights",
            size: 16 + this.lightsArray.byteLength, // 16 for numLights + padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this.populateLightsBuffer();
        this.updateLightSetUniformNumLights();

        this.timeUniformBuffer = this.gpu.device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.moveLightsComputeBindGroupLayout = this.gpu.device.createBindGroupLayout({
            label: "move lights compute bind group layout",
            entries: [
                { // lightSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.moveLightsComputeBindGroup = this.gpu.device.createBindGroup({
            label: "move lights compute bind group",
            layout: this.moveLightsComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightSetStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                }
            ]
        });

        this.moveLightsComputePipeline = this.gpu.device.createComputePipeline({
            label: "move lights compute pipeline",
            layout: this.gpu.device.createPipelineLayout({
                label: "move lights compute pipeline layout",
                bindGroupLayouts: [ this.moveLightsComputeBindGroupLayout ]
            }),
            compute: {
                module: this.gpu.device.createShaderModule({
                    label: "move lights compute shader",
                    code: shaders.moveLightsComputeSrc
                }),
                entryPoint: "main"
            }
        });

        this.clusterAABBsBuffer = this.gpu.device.createBuffer({
            label: "cluster AABBs",
            size: numClusters * 32, // 2 vec4f per AABB
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.visibleLightsBuffer = this.gpu.device.createBuffer({
            label: "visible lights",
            size: Lights.maxNumLights * 16, // vec3f view position + u32 light index
            usage: GPUBufferUsage.STORAGE
        });

        this.lightGridBuffer = this.gpu.device.createBuffer({
            label: "light grid",
            size: numClusters * 8,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.globalLightIndexListBuffer = this.gpu.device.createBuffer({
            label: "global light index list",
            size: shaders.constants.maxClusterLightIndices * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.clusteringCountersBuffer = this.gpu.device.createBuffer({
            label: "clustering counters",
            size: 16, // visibleLightCount, lightIndexCount, overflow, padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });

        this.clusteringComputeBindGroupLayout = this.gpu.device.createBindGroupLayout({
            label: "clustering compute bind group layout",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterAABBs
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // visibleLights
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // lightGrid
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // globalLightIndexList
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // counters
                    binding: 6,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                }
            ]
        });

        this.clusteringComputeBindGroup = this.gpu.device.createBindGroup({
            label: "clustering compute bind group",
            layout: this.clusteringComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lightSetStorageBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: this.clusterAABBsBuffer }
                },
                {
                    binding: 3,
                    resource: { buffer: this.visibleLightsBuffer }
                },
                {
                    binding: 4,
                    resource: { buffer: this.lightGridBuffer }
                },
                {
                    binding: 5,
                    resource: { buffer: this.globalLightIndexListBuffer }
                },
                {
                    binding: 6,
                    resource: { buffer: this.clusteringCountersBuffer }
                }
            ]
        });

        const clusteringPipelineLayout = this.gpu.device.createPipelineLayout({
            label: "clustering compute pipeline layout",
            bindGroupLayouts: [ this.clusteringComputeBindGroupLayout ]
        });

        this.clusterBoundsComputePipeline = this.gpu.device.createComputePipeline({
            label: "cluster bounds compute pipeline",
            layout: clusteringPipelineLayout,
            compute: {
                module: this.gpu.device.createShaderModule({
                    label: "cluster bounds compute shader",
                    code: shaders.clusterBoundsComputeSrc
                }),
                entryPoint: "main"
            }
        });

        this.lightCullingComputePipeline = this.gpu.device.createComputePipeline({
            label: "light culling compute pipeline",
            layout: clusteringPipelineLayout,
            compute: {
                module: this.gpu.device.createShaderModule({
                    label: "light culling compute shader",
                    code: shaders.lightCullingComputeSrc
                }),
                entryPoint: "main"
            }
        });

        this.lightAssignmentComputePipeline = this.gpu.device.createComputePipeline({
            label: "light assignment compute pipeline",
            layout: clusteringPipelineLayout,
            compute: {
                module: this.gpu.device.createShaderModule({
                    label: "light assignment compute shader",
                    code: shaders.lightAssignmentComputeSrc
                }),
                entryPoint: "main"
            }
        });
    }

    private populateLightsBuffer() {
        for (let lightIdx = 0; lightIdx < Lights.maxNumLights; ++lightIdx) {
            // light pos is set by compute shader so no need to set it here
            const lightColor = vec3.scale(hueToRgb(Math.random()), Lights.lightIntensity);
            this.lightsArray.set(lightColor, (lightIdx * Lights.numFloatsPerLight) + 4);
        }

        this.gpu.device.queue.writeBuffer(this.lightSetStorageBuffer, 16, this.lightsArray);
    }

    updateLightSetUniformNumLights() {
        this.gpu.device.queue.writeBuffer(this.lightSetStorageBuffer, 0, new Uint32Array([this.numLights]));
    }

    // Needs this frame's camera uniforms, which the driver writes (camera.onFrame) before encoding the frame
    doLightClustering(encoder: GPUCommandEncoder) {
        encoder.clearBuffer(this.clusteringCountersBuffer);

        const computePass = encoder.beginComputePass({
            label: "light clustering compute pass"
        });
        computePass.setBindGroup(0, this.clusteringComputeBindGroup);

        // Each dispatch sees the previous one's storage writes, so the three steps can share one pass
        const clusterWorkgroups = Math.ceil(numClusters / shaders.constants.clusteringWorkgroupSize);

        if (this.clusterBoundsDirty) {
            computePass.setPipeline(this.clusterBoundsComputePipeline);
            computePass.dispatchWorkgroups(clusterWorkgroups);
            this.clusterBoundsDirty = false;
        }

        computePass.setPipeline(this.lightCullingComputePipeline);
        computePass.dispatchWorkgroups(Math.ceil(this.numLights / shaders.constants.lightCullingWorkgroupSize));

        computePass.setPipeline(this.lightAssignmentComputePipeline);
        computePass.dispatchWorkgroups(clusterWorkgroups);

        computePass.end();
    }

    // Reads back the most recently submitted frame's counters. Stalls only this promise, not rendering.
    async readClusteringStats(): Promise<ClusteringStats> {
        const readbackBuffer = this.gpu.device.createBuffer({
            label: "clustering counters readback",
            size: 16,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });

        const encoder = this.gpu.device.createCommandEncoder();
        encoder.copyBufferToBuffer(this.clusteringCountersBuffer, 0, readbackBuffer, 0, 16);
        this.gpu.device.queue.submit([encoder.finish()]);

        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const [visibleLights, lightIndices, overflow] = new Uint32Array(readbackBuffer.getMappedRange());
        readbackBuffer.destroy();

        return { visibleLights, lightIndices, overflowed: overflow != 0 };
    }

    // CHECKITOUT: this is where the light movement compute shader is dispatched from the host
    onFrame(time: number) {
        this.gpu.device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        // not using same encoder as render pass so this doesn't interfere with measuring actual rendering performance
        const encoder = this.gpu.device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.moveLightsComputePipeline);

        computePass.setBindGroup(0, this.moveLightsComputeBindGroup);

        const workgroupCount = Math.ceil(this.numLights / shaders.constants.moveLightsWorkgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        this.gpu.device.queue.submit([encoder.finish()]);
    }
}
