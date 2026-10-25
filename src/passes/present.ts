import { GpuContext } from '../gpu/context';
import * as shaders from '../shaders/shaders';

// Scales a finished frame onto the canvas, letterboxed to keep its aspect ratio. This is the only pass whose cost
// depends on the canvas size, so drivers keep it out of anything they measure.
export class PresentPass {
    private gpu: GpuContext;
    private source: GPUTexture;

    private bindGroup: GPUBindGroup;
    private pipeline: GPURenderPipeline;

    constructor(gpu: GpuContext, source: GPUTexture) {
        this.gpu = gpu;
        this.source = source;

        const bindGroupLayout = gpu.device.createBindGroupLayout({
            label: "present bind group layout",
            entries: [
                { // finished frame
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // linear sampler
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                }
            ]
        });

        this.bindGroup = gpu.device.createBindGroup({
            label: "present bind group",
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: source.createView()
                },
                {
                    binding: 1,
                    resource: gpu.device.createSampler({
                        magFilter: "linear",
                        minFilter: "linear"
                    })
                }
            ]
        });

        this.pipeline = gpu.device.createRenderPipeline({
            label: "present pipeline",
            layout: gpu.device.createPipelineLayout({
                label: "present pipeline layout",
                bindGroupLayouts: [ bindGroupLayout ]
            }),
            vertex: {
                module: gpu.device.createShaderModule({
                    label: "present vert shader",
                    code: shaders.fullscreenVertSrc
                })
            },
            fragment: {
                module: gpu.device.createShaderModule({
                    label: "present frag shader",
                    code: shaders.blitFragSrc
                }),
                targets: [
                    {
                        format: gpu.canvasFormat
                    }
                ]
            }
        });
    }

    encode(encoder: GPUCommandEncoder) {
        const canvas = this.gpu.canvas;

        // Largest rectangle with the source's aspect ratio that fits the canvas, centered. Rounded and clamped so the
        // viewport never pokes past the canvas edge through float error.
        const scale = Math.min(canvas.width / this.source.width, canvas.height / this.source.height);
        const width = Math.min(canvas.width, Math.round(this.source.width * scale));
        const height = Math.min(canvas.height, Math.round(this.source.height * scale));
        const x = Math.floor((canvas.width - width) / 2);
        const y = Math.floor((canvas.height - height) / 2);

        const pass = encoder.beginRenderPass({
            label: "present pass",
            colorAttachments: [
                {
                    view: this.gpu.canvasContext.getCurrentTexture().createView(),
                    clearValue: [0, 0, 0, 1],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ]
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.setViewport(x, y, width, height, 0, 1);
        pass.draw(6);
        pass.end();
    }
}
