import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    // G-buffer textures
    gBufferPositionTexture: GPUTexture;
    gBufferPositionTextureView: GPUTextureView;

    gBufferNormalTexture: GPUTexture;
    gBufferNormalTextureView: GPUTextureView;

    gBufferAlbedoTexture: GPUTexture;
    gBufferAlbedoTextureView: GPUTextureView;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    gBufferBindGroupLayout: GPUBindGroupLayout;
    gBufferBindGroup: GPUBindGroup;

    fullscreenBindGroupLayout: GPUBindGroupLayout;
    fullscreenBindGroup: GPUBindGroup;

    gBufferPipeline: GPURenderPipeline;
    fullscreenPipeline: GPURenderPipeline;

    gBufferSampler: GPUSampler;

    constructor(stage: Stage) {
        super(stage);

        this.gBufferPositionTexture = this.gpu.device.createTexture({
            size: [this.gpu.canvas.width, this.gpu.canvas.height],
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.gBufferPositionTextureView = this.gBufferPositionTexture.createView();

        this.gBufferNormalTexture = this.gpu.device.createTexture({
            size: [this.gpu.canvas.width, this.gpu.canvas.height],
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.gBufferNormalTextureView = this.gBufferNormalTexture.createView();

        this.gBufferAlbedoTexture = this.gpu.device.createTexture({
            size: [this.gpu.canvas.width, this.gpu.canvas.height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.gBufferAlbedoTextureView = this.gBufferAlbedoTexture.createView();

        this.depthTexture = this.gpu.device.createTexture({
            size: [this.gpu.canvas.width, this.gpu.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();

        this.gBufferSampler = this.gpu.device.createSampler({
            magFilter: "nearest",
            minFilter: "nearest"
        });

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
                { // G-buffer position texture
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // G-buffer normal texture
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                },
                { // G-buffer albedo texture
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // G-buffer sampler
                    binding: 7,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: { type: "non-filtering" }
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
                    resource: this.gBufferPositionTextureView
                },
                {
                    binding: 5,
                    resource: this.gBufferNormalTextureView
                },
                {
                    binding: 6,
                    resource: this.gBufferAlbedoTextureView
                },
                {
                    binding: 7,
                    resource: this.gBufferSampler
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
                format: "depth24plus"
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
                        format: "rgba16float" // position and depth
                    },
                    {
                        format: "rgba16float" // normal
                    },
                    {
                        format: "rgba8unorm" // albedo
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
                    code: shaders.clusteredDeferredFullscreenVertSrc
                })
            },
            fragment: {
                module: this.gpu.device.createShaderModule({
                    label: "clustered deferred fullscreen frag shader",
                    code: shaders.clusteredDeferredFullscreenFragSrc
                }),
                targets: [
                    {
                        format: this.gpu.canvasFormat
                    }
                ]
            }
        });
    }

    override draw() {
        const encoder = this.gpu.device.createCommandEncoder();

        // Run clustering compute shader
        this.lights.doLightClustering(encoder);

        // G-buffer pass
        const gBufferPass = encoder.beginRenderPass({
            label: "clustered deferred G-buffer pass",
            colorAttachments: [
                {
                    view: this.gBufferPositionTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.gBufferNormalTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                },
                {
                    view: this.gBufferAlbedoTextureView,
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
        const canvasTextureView = this.gpu.canvasContext.getCurrentTexture().createView();

        const fullscreenPass = encoder.beginRenderPass({
            label: "clustered deferred fullscreen pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
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

        this.gpu.device.queue.submit([encoder.finish()]);
    }
}
