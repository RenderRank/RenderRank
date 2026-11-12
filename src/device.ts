export interface DeviceDetails {
    gpu: string;
    system: string;
    browser: string;
    cores: string;
}

// Browsers deliberately expose different amounts of hardware information. Report only
// supplied values; user-agent OS version strings can be frozen, so don't display them.
export function inspectDevice(adapter?: GPUAdapter): DeviceDetails {
    const ua = navigator.userAgent;
    const browser = ua.match(/Edg\/([\d.]+)/) ?? ua.match(/Firefox\/([\d.]+)/) ?? ua.match(/(?:Chrome|CriOS)\/([\d.]+)/) ?? ua.match(/Version\/([\d.]+).*Safari/);
    const browserName = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /(?:Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const system = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iOS / iPadOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : navigator.platform || 'Not disclosed';
    const info = adapter?.info;
    let gpu = info?.description || '';
    if (!gpu) {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
            const debug = gl.getExtension('WEBGL_debug_renderer_info');
            if (debug) {
                const renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
                gpu = renderer.match(/ANGLE Metal Renderer:\s*([^,)]+)/)?.[1]
                    ?? renderer.replace(/^ANGLE\s*\([^,]+,\s*/, '').replace(/,\s*(?:D3D\d+|OpenGL|Unspecified Version).*\)?$/, '').replace(/\)$/, '');
            }
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    }
    if (!gpu) gpu = [info?.vendor, info?.architecture, info?.device].filter(Boolean).join(' · ');
    return {
        gpu: gpu || 'GPU model not disclosed',
        system,
        browser: browser ? `${browserName} ${browser[1].split('.')[0]}` : browserName,
        cores: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} logical cores` : 'Core count not disclosed',
    };
}

export interface DeviceReport {
    summary: DeviceDetails;
    userAgent: string;
    platform: string;
    logicalCores?: number;
    deviceMemoryGiB?: number;
    maxTouchPoints: number;
    crossOriginIsolated: boolean;
    screen: {
        width: number;
        height: number;
        availableWidth: number;
        availableHeight: number;
        colorDepth: number;
        devicePixelRatio: number;
        highDynamicRange: boolean;
    };
    // Whatever the browser returns for the requested hints; the set of keys varies
    clientHints?: Record<string, unknown>;
    webgpu?: {
        vendor: string;
        architecture: string;
        device: string;
        description: string;
        subgroupMinSize?: number;
        subgroupMaxSize?: number;
        isFallbackAdapter: boolean;
        preferredCanvasFormat: string;
        features: string[];
        limits: Record<string, number>;
    };
    webgl?: { vendor: string; renderer: string; version: string };
    battery?: { charging: boolean; level: number };
}

// Everything the browser will say about the machine, for attaching to an uploaded result. Fields a browser doesn't
// expose are left out rather than guessed. Nothing here identifies a person: no IP address, language, or time zone.
export async function collectDeviceReport(adapter?: GPUAdapter): Promise<DeviceReport> {
    const report: DeviceReport = {
        summary: inspectDevice(adapter),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        logicalCores: navigator.hardwareConcurrency,
        deviceMemoryGiB: (navigator as { deviceMemory?: number }).deviceMemory, // Chromium only, and bucketed
        maxTouchPoints: navigator.maxTouchPoints,
        crossOriginIsolated: window.crossOriginIsolated,
        screen: {
            width: screen.width,
            height: screen.height,
            availableWidth: screen.availWidth,
            availableHeight: screen.availHeight,
            colorDepth: screen.colorDepth,
            devicePixelRatio: window.devicePixelRatio,
            highDynamicRange: matchMedia('(dynamic-range: high)').matches,
        },
    };

    // User-Agent Client Hints (Chromium): exact browser and OS versions, CPU architecture, phone model
    const uaData = (navigator as { userAgentData?: { brands: unknown; mobile: boolean; platform: string; getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> } }).userAgentData;
    if (uaData) {
        try {
            report.clientHints = await uaData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'formFactors', 'wow64']);
        } catch {
            report.clientHints = { brands: uaData.brands, mobile: uaData.mobile, platform: uaData.platform };
        }
    }

    if (adapter) {
        const info = adapter.info;
        const limits: Record<string, number> = {};
        for (const name in adapter.limits) {
            const value = adapter.limits[name as keyof GPUSupportedLimits];
            if (typeof value === 'number') limits[name] = value;
        }
        report.webgpu = {
            vendor: info.vendor,
            architecture: info.architecture,
            device: info.device,
            description: info.description,
            subgroupMinSize: info.subgroupMinSize,
            subgroupMaxSize: info.subgroupMaxSize,
            isFallbackAdapter: info.isFallbackAdapter,
            preferredCanvasFormat: navigator.gpu.getPreferredCanvasFormat(),
            features: [...adapter.features].sort(),
            limits,
        };
    }

    // The WebGL renderer string usually names the GPU model and graphics backend where WebGPU doesn't
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        report.webgl = {
            vendor: String(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
            renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
            version: String(gl.getParameter(gl.VERSION)),
        };
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }

    // Laptops often cap the GPU on battery, so the power state explains some results (Chromium only)
    const getBattery = (navigator as { getBattery?: () => Promise<{ charging: boolean; level: number }> }).getBattery;
    if (getBattery) {
        try {
            const battery = await getBattery.call(navigator);
            report.battery = { charging: battery.charging, level: battery.level };
        } catch { /* blocked by permissions policy */ }
    }

    return report;
}
