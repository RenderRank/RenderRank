import * as shaders from '../shaders/shaders';

export function mipLevelCount(width: number, height: number): number {
    return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

// Fills mip levels 1..n of 2D textures by rendering each level from the one above it with a linear filter. For -srgb
// formats the hardware decodes when sampling and encodes when writing, so the filtering happens in linear space.
export class MipmapGenerator {
    private device: GPUDevice;

    private bindGroupLayout: GPUBindGroupLayout;
    private pipelineLayout: GPUPipelineLayout;
    private vertModule: GPUShaderModule;
    private fragModule: GPUShaderModule;
    private sampler: GPUSampler;

    // Render pipelines are tied to their target format, so there's one per texture format seen
    private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();

    constructor(device: GPUDevice) {
        this.device = device;

        this.bindGroupLayout = device.createBindGroupLayout({
            label: "mipmap bind group layout",
            entries: [
                { // previous mip level
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

        this.pipelineLayout = device.createPipelineLayout({
            label: "mipmap pipeline layout",
            bindGroupLayouts: [ this.bindGroupLayout ]
        });

        this.vertModule = device.createShaderModule({
            label: "mipmap vert shader",
            code: shaders.fullscreenVertSrc
        });

        this.fragModule = device.createShaderModule({
            label: "mipmap frag shader",
            code: shaders.blitFragSrc
        });

        this.sampler = device.createSampler({
            magFilter: "linear",
            minFilter: "linear"
        });
    }

    private getPipeline(format: GPUTextureFormat): GPURenderPipeline {
        let pipeline = this.pipelines.get(format);
        if (pipeline == undefined) {
            pipeline = this.device.createRenderPipeline({
                label: `mipmap pipeline (${format})`,
                layout: this.pipelineLayout,
                vertex: { module: this.vertModule },
                fragment: {
                    module: this.fragModule,
                    targets: [ { format: format } ]
                }
            });
            this.pipelines.set(format, pipeline);
        }
        return pipeline;
    }

    // The texture needs TEXTURE_BINDING and RENDER_ATTACHMENT usage, with level 0 already filled
    generate(texture: GPUTexture) {
        if (texture.mipLevelCount < 2) {
            return;
        }

        const pipeline = this.getPipeline(texture.format);
        const encoder = this.device.createCommandEncoder({ label: "mipmap generation" });

        for (let level = 1; level < texture.mipLevelCount; ++level) {
            const bindGroup = this.device.createBindGroup({
                label: "mipmap bind group",
                layout: this.bindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 })
                    },
                    {
                        binding: 1,
                        resource: this.sampler
                    }
                ]
            });

            const pass = encoder.beginRenderPass({
                label: "mipmap pass",
                colorAttachments: [
                    {
                        view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
                        loadOp: "clear",
                        storeOp: "store"
                    }
                ]
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(6);
            pass.end();
        }

        this.device.queue.submit([encoder.finish()]);
    }
}
