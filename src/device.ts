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
