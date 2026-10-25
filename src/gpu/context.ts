// Plain-object copy of GPUAdapterInfo. The browser object exposes its fields as prototype getters, so it can't be
// serialized directly (JSON.stringify gives {}).
export interface AdapterInfoSnapshot {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    subgroupMinSize?: number;
    subgroupMaxSize?: number;
    isFallbackAdapter: boolean;
}

export interface GpuContextOptions {
    powerPreference?: GPUPowerPreference;
}

// GPUSupportedLimits are also prototype getters, which for...in reaches but Object.keys doesn't
function snapshotLimits(limits: GPUSupportedLimits): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const name in limits) {
        const value = limits[name as keyof GPUSupportedLimits];
        if (typeof value === 'number') {
            snapshot[name] = value;
        }
    }
    return snapshot;
}

// Owns the WebGPU adapter, device, and canvas configuration, plus the bind group layouts shared by all renderers.
// One instance is created at startup and passed to everything that touches the GPU.
export class GpuContext {
    readonly adapter: GPUAdapter;
    readonly device: GPUDevice;

    readonly canvas: HTMLCanvasElement;
    readonly canvasContext: GPUCanvasContext;
    readonly canvasFormat: GPUTextureFormat;

    // What the hardware reports, recorded once so results can say what they ran on
    readonly adapterInfo: AdapterInfoSnapshot;
    readonly adapterFeatures: string[];
    readonly adapterLimits: Record<string, number>;

    // timestamp-query is requested only when the adapter offers it; GPU pass timings are diagnostics, not required
    readonly hasTimestampQuery: boolean;

    // Resolves if the device is lost (driver crash, GPU reset, ...). Nothing created from this context works after that.
    readonly lost: Promise<GPUDeviceLostInfo>;

    readonly modelBindGroupLayout: GPUBindGroupLayout;
    readonly materialBindGroupLayout: GPUBindGroupLayout;

    static async create(canvas: HTMLCanvasElement, options: GpuContextOptions = {}): Promise<GpuContext> {
        if (!navigator.gpu) {
            throw new Error("This browser doesn't support WebGPU! Try using Google Chrome.");
        }

        // high-performance so dual-GPU laptops pick the discrete GPU
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: options.powerPreference ?? 'high-performance'
        });
        if (!adapter) {
            throw new Error("No appropriate GPUAdapter found");
        }

        const requiredFeatures: GPUFeatureName[] = [];
        if (adapter.features.has('timestamp-query')) {
            requiredFeatures.push('timestamp-query');
        }

        const device = await adapter.requestDevice({ requiredFeatures });

        return new GpuContext(canvas, adapter, device);
    }

    private constructor(canvas: HTMLCanvasElement, adapter: GPUAdapter, device: GPUDevice) {
        this.adapter = adapter;
        this.device = device;

        const info = adapter.info;
        this.adapterInfo = {
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
            subgroupMinSize: info.subgroupMinSize,
            subgroupMaxSize: info.subgroupMaxSize,
            isFallbackAdapter: info.isFallbackAdapter
        };
        this.adapterFeatures = [...adapter.features].sort();
        this.adapterLimits = snapshotLimits(adapter.limits);
        this.hasTimestampQuery = device.features.has('timestamp-query');

        this.lost = device.lost;
        this.lost.then((lostInfo) => {
            console.error(`WebGPU device lost (${lostInfo.reason}): ${lostInfo.message}`);
        });

        this.canvas = canvas;
        this.resizeCanvas();
        // Frames render offscreen at a fixed resolution, so resizing only changes the final present blit
        new ResizeObserver(() => this.resizeCanvas()).observe(canvas);

        this.canvasContext = canvas.getContext("webgpu")!;
        this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.canvasContext.configure({
            device: device,
            format: this.canvasFormat,
        });

        console.log("WebGPU init successful", this.adapterInfo);

        this.modelBindGroupLayout = device.createBindGroupLayout({
            label: "model bind group layout",
            entries: [
                { // modelMat
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.materialBindGroupLayout = device.createBindGroupLayout({
            label: "material bind group layout",
            entries: [
                { // baseColorTex
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // baseColorSampler
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                },
                { // normalTex
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // normalSampler
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                },
                { // metallicRoughnessTex
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {}
                },
                { // metallicRoughnessSampler
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {}
                },
                { // material uniforms
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" }
                }
            ]
        });
    }

    // Matches the canvas backing store to its on-screen size in device pixels
    private resizeCanvas() {
        const devicePixelRatio = window.devicePixelRatio;
        this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * devicePixelRatio));
        this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * devicePixelRatio));
    }
}
