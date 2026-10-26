import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';
import { TonemapPass } from '../passes/tonemap';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    // G-buffer textures: 8 bytes per pixel plus depth. World position isn't stored; it's rebuilt from depth.
    gBufferAlbedoMetallicTexture: GPUTexture;
    gBufferAlbedoMetallicTextureView: GPUTextureView;

    gBufferNormalRoughnessTexture: GPUTexture;
    gBufferNormalRoughnessTextureView: GPUTextureView;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    // Lighting accumulates here unclamped; the tonemap pass maps it to the output
    hdrTexture: GPUTexture;
    hdrTextureView: GPUTextureView;

    tonemapPass: TonemapPass;
    readonly outputTexture: GPUTexture;

    gBufferBindGroupLayout: GPUBindGroupLayout;
    gBufferBindGroup: GPUBindGroup;

    fullscreenBindGroupLayout: GPUBindGroupLayout;
    fullscreenBindGroup: GPUBindGroup;

    gBufferPipeline: GPURenderPipeline;
    fullscreenPipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        const size = [this.resolution.width, this.resolution.height];

        // Base color + metallic. -srgb so linear albedo keeps its precision in dark tones; it's encoded on write and
        // decoded on read. Alpha (metallic) is always stored linear.
        this.gBufferAlbedoMetallicTexture = this.gpu.device.createTexture({
            label: "G-buffer albedo + metallic",
            size: size,
            format: "rgba8unorm-srgb",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.gBufferAlbedoMetallicTextureView = this.gBufferAlbedoMetallicTexture.createView();

        // Octahedral normal at 10 bits per axis + 10-bit roughness
        this.gBufferNormalRoughnessTexture = this.gpu.device.createTexture({
            label: "G-buffer normal + roughness",
            size: size,
            format: "rgb10a2unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.gBufferNormalRoughnessTextureView = this.gBufferNormalRoughnessTexture.createView();

        // Sampled by the lighting pass to rebuild positions. depth32float rather than depth24plus because the latter
        // maps to different physical formats per backend, and the benchmark's bandwidth shouldn't vary that way.
        this.depthTexture = this.gpu.device.createTexture({
            label: "depth",
            size: size,
            format: "depth32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.depthTextureView = this.depthTexture.createView();

        this.hdrTexture = this.gpu.device.createTexture({
            label: "HDR lighting",
            size: size,
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.hdrTextureView = this.hdrTexture.createView();

        this.tonemapPass = new TonemapPass(this.gpu, this.hdrTexture);
        this.outputTexture = this.tonemapPass.outputTexture;

        this.gBufferBindGroupLayout = this.gpu.device.createBindGroupLayout({
            label: "clustered deferred G-buffer bind group layout",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.gBufferBindGroup = this.gpu.device.createBindGroup({
            label: "clustered deferred G-buffer bind group",
            layout: this.gBufferBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                }
            ]
        });

        this.fullscreenBindGroupLayout = this.gpu.device.createBindGroupLayout({
            label: "clustered deferred fullscreen bind group layout",
            entries: [
                { // camera uniforms
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // lightGrid
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // globalLightIndexList
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage" }
                },
                { // depth texture
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "depth" }
                },
                { // G-buffer albedo + metallic texture
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // G-buffer normal + roughness texture
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                }
            ]
        });

        this.fullscreenBindGroup = this.gpu.device.createBindGroup({
            label: "clustered deferred fullscreen bind group",
            layout: this.fullscreenBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lights.lightSetStorageBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: this.lights.lightGridBuffer }
                },
                {
                    binding: 3,
                    resource: { buffer: this.lights.globalLightIndexListBuffer }
                },
                {
                    binding: 4,
                    resource: this.depthTextureView
                },
                {
                    binding: 5,
                    resource: this.gBufferAlbedoMetallicTextureView
                },
                {
                    binding: 6,
                    resource: this.gBufferNormalRoughnessTextureView
                }
            ]
        });

        // Create G-buffer pipeline
        this.gBufferPipeline = this.gpu.device.createRenderPipeline({
            layout: this.gpu.device.createPipelineLayout({
                label: "clustered deferred G-buffer pipeline layout",
                bindGroupLayouts: [
                    this.gBufferBindGroupLayout,
                    this.gpu.modelBindGroupLayout,
                    this.gpu.materialBindGroupLayout
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth32float"
            },
            vertex: {
                module: this.gpu.device.createShaderModule({
                    label: "clustered deferred G-buffer vert shader",
                    code: shaders.clusteredDeferredVertSrc
                }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: {
                module: this.gpu.device.createShaderModule({
                    label: "clustered deferred G-buffer frag shader",
                    code: shaders.clusteredDeferredFragSrc
                }),
                targets: [
                    {
                        format: "rgba8unorm-srgb" // albedo + metallic
                    },
                    {
                        format: "rgb10a2unorm" // octahedral normal + roughness
                    }
                ]
            }
        });

        // Create fullscreen pipeline
        this.fullscreenPipeline = this.gpu.device.createRenderPipeline({
            layout: this.gpu.device.createPipelineLayout({
                label: "clustered deferred fullscreen pipeline layout",
                bindGroupLayouts: [
                    this.fullscreenBindGroupLayout
                ]
            }),
            vertex: {
                module: this.gpu.device.createShaderModule({
                    label: "clustered deferred fullscreen vert shader",
                    code: shaders.fullscreenVertSrc
                })
            },
            fragment: {
                module: this.gpu.device.createShaderModule({
                    label: "clustered deferred fullscreen frag shader",
                    code: shaders.clusteredDeferredFullscreenFragSrc
                }),
                targets: [
                    {
                        format: "rgba16float" // HDR lighting
                    }
                ]
            }
        });
    }

    override encodeFrame(encoder: GPUCommandEncoder) {
        // Run clustering compute shader
        this.lights.doLightClustering(encoder);

        // G-buffer pass
        const gBufferPass = encoder.beginRenderPass({
            label: "clustered deferred G-buffer pass",
            colorAttachments: [
                {
                    view: this.gBufferAlbedoMetallicTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.gBufferNormalRoughnessTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });

        gBufferPass.setPipeline(this.gBufferPipeline);
        gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.gBufferBindGroup);

        this.scene.iterate(node => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            gBufferPass.setVertexBuffer(0, primitive.vertexBuffer);
            gBufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            gBufferPass.drawIndexed(primitive.numIndices);
        });

        gBufferPass.end();

        // Fullscreen lighting pass
        const fullscreenPass = encoder.beginRenderPass({
            label: "clustered deferred fullscreen pass",
            colorAttachments: [
                {
                    view: this.hdrTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ]
        });

        fullscreenPass.setPipeline(this.fullscreenPipeline);
        fullscreenPass.setBindGroup(0, this.fullscreenBindGroup);
        fullscreenPass.draw(6); // Draw 6 vertices (2 triangles for fullscreen quad)

        fullscreenPass.end();

        this.tonemapPass.encode(encoder);
    }

    override destroy() {
        this.gBufferAlbedoMetallicTexture.destroy();
        this.gBufferNormalRoughnessTexture.destroy();
        this.depthTexture.destroy();
        this.hdrTexture.destroy();
        this.tonemapPass.destroy();
    }
}
