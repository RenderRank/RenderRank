import { GpuContext } from '../gpu/context';
import * as shaders from '../shaders/shaders';

// Turns the HDR lighting result into the finished frame: ACES tone curve, then sRGB encoding into an rgba8unorm
// texture of the same size. It runs at the render resolution, so its cost is part of the frame.
export class TonemapPass {
    readonly outputTexture: GPUTexture;
    private outputTextureView: GPUTextureView;

    private bindGroup: GPUBindGroup;
    private pipeline: GPURenderPipeline;

    constructor(gpu: GpuContext, hdrTexture: GPUTexture) {
        this.outputTexture = gpu.device.createTexture({
            label: "tonemapped output",
            size: [hdrTexture.width, hdrTexture.height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.outputTextureView = this.outputTexture.createView();

        const bindGroupLayout = gpu.device.createBindGroupLayout({
            label: "tonemap bind group layout",
            entries: [
                { // HDR lighting texture
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                }
            ]
        });

        this.bindGroup = gpu.device.createBindGroup({
            label: "tonemap bind group",
            layout: bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: hdrTexture.createView()
                }
            ]
        });

        this.pipeline = gpu.device.createRenderPipeline({
            label: "tonemap pipeline",
            layout: gpu.device.createPipelineLayout({
                label: "tonemap pipeline layout",
                bindGroupLayouts: [ bindGroupLayout ]
            }),
            vertex: {
                module: gpu.device.createShaderModule({
                    label: "tonemap vert shader",
                    code: shaders.fullscreenVertSrc
                })
            },
            fragment: {
                module: gpu.device.createShaderModule({
                    label: "tonemap frag shader",
                    code: shaders.tonemapFragSrc
                }),
                targets: [
                    {
                        format: "rgba8unorm"
                    }
                ]
            }
        });
    }

    encode(encoder: GPUCommandEncoder) {
        const pass = encoder.beginRenderPass({
            label: "tonemap pass",
            colorAttachments: [
                {
                    view: this.outputTextureView,
                    clearValue: [0, 0, 0, 1],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ]
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.draw(6);
        pass.end();
    }
}
