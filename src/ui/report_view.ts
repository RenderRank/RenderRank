// Shows a run report in full on the results screen: readable groups for the run and device details, and the exact
// JSON that Upload score sends.
import type { RunReport } from '../report';

type Entry = [label: string, value: unknown];

const notReported = 'Not reported';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function display(value: unknown): string {
    if (value === undefined || value === null || value === '') return notReported;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return value.toLocaleString();
    if (Array.isArray(value)) {
        if (value.length === 0) return 'None';
        // Client hints report browser versions as { brand, version } pairs
        return value.map(item => item && typeof item === 'object' && 'brand' in item
            ? `${(item as { brand: string }).brand} ${(item as { version: string }).version}` : String(item)).join(', ');
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function definitionList(entries: Entry[], className = 'report-list'): HTMLDListElement {
    const list = node('dl', className);
    for (const [label, value] of entries) {
        const row = node('div');
        const text = display(value);
        row.append(node('dt', undefined, label), node('dd', text === notReported ? 'missing' : undefined, text));
        list.append(row);
    }
    return list;
}

function card(title: string, content: HTMLElement, options: { wide?: boolean; count?: number } = {}): HTMLElement {
    const section = node('section', options.wide ? 'report-card wide' : 'report-card');
    const heading = node('h3', undefined, title);
    if (options.count !== undefined) heading.append(node('span', undefined, ` ${options.count}`));
    section.append(heading, content);
    return section;
}

// Labels for the client hints we request, in display order. Anything else the browser returns is shown under its own key.
const clientHintLabels: Record<string, string> = {
    platform: 'Platform',
    platformVersion: 'Platform version',
    architecture: 'CPU architecture',
    bitness: 'Bitness',
    model: 'Device model',
    formFactors: 'Form factors',
    mobile: 'Mobile',
    wow64: '32-bit on 64-bit Windows',
    fullVersionList: 'Full browser versions',
    brands: 'Browser brands',
};

// JSON with arrays of plain values kept on one line, so long series stay readable
export function formatJson(value: unknown, indent = ''): string {
    const inner = indent + '  ';
    if (Array.isArray(value)) {
        if (value.every(item => item === null || typeof item !== 'object')) return `[${value.map(item => JSON.stringify(item)).join(', ')}]`;
        return `[\n${value.map(item => inner + formatJson(item, inner)).join(',\n')}\n${indent}]`;
    }
    if (value !== null && typeof value === 'object') {
        // JSON.stringify drops undefined fields, so the display does too
        const entries = Object.entries(value).filter(([, item]) => item !== undefined);
        if (entries.length === 0) return '{}';
        return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatJson(item, inner)}`).join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

export function renderReport(container: HTMLElement, report: RunReport) {
    const { device } = report;
    const grid = node('div', 'report-grid');

    const segments = report.segments.map(segment => `${segment.label} at ${(segment.tMs / 1000).toFixed(1)} s`).join(', ');
    grid.append(card('Run', definitionList([
        ['Finished', new Date(report.finishedAt).toLocaleString()],
        ['Scene', `${report.scene.name} (${report.scene.id}, ${report.scene.kind})`],
        ['Renderer', report.scene.renderer],
        ['Resolution', `${report.settings.resolution} · ${report.settings.width} × ${report.settings.height}`],
        ['Frame-time samples', report.frameTimes.tMs.length],
        ['Segments', segments],
        ['Page', report.page],
        ['Report schema', `Version ${report.schemaVersion}`],
    ])));

    grid.append(card('Device', definitionList([
        ['GPU', device.summary.gpu],
        ['System', device.summary.system],
        ['Browser', device.summary.browser],
        ['CPU', device.logicalCores ? `${device.logicalCores} logical cores` : undefined],
        ['Memory', device.deviceMemoryGiB ? `About ${device.deviceMemoryGiB} GB (rounded by the browser)` : undefined],
        ['Power', device.battery ? `${device.battery.charging ? 'Charging' : 'On battery'}, ${Math.round(device.battery.level * 100)}%` : undefined],
        ['Touch points', device.maxTouchPoints],
        ['Platform string', device.platform],
        ['Cross-origin isolated', device.crossOriginIsolated],
    ])));

    const hints = device.clientHints ?? {};
    const hintEntries: Entry[] = [
        ...Object.keys(clientHintLabels).filter(key => key in hints).map((key): Entry => [clientHintLabels[key], hints[key]]),
        ...Object.keys(hints).filter(key => !(key in clientHintLabels)).map((key): Entry => [key, hints[key]]),
    ];
    if (hintEntries.length === 0) hintEntries.push(['Client hints', undefined]);
    hintEntries.push(['User agent', device.userAgent]);
    grid.append(card('Browser and OS', definitionList(hintEntries)));

    grid.append(card('Display', definitionList([
        ['Screen', `${device.screen.width} × ${device.screen.height}`],
        ['Available area', `${device.screen.availableWidth} × ${device.screen.availableHeight}`],
        ['Color depth', `${device.screen.colorDepth}-bit`],
        ['Device pixel ratio', device.screen.devicePixelRatio],
        ['High dynamic range', device.screen.highDynamicRange],
    ])));

    const gpu = device.webgpu;
    grid.append(card('WebGPU adapter', definitionList(gpu ? [
        ['Vendor', gpu.vendor],
        ['Architecture', gpu.architecture],
        ['Device', gpu.device],
        ['Description', gpu.description],
        ['Subgroup sizes', gpu.subgroupMinSize !== undefined ? `${gpu.subgroupMinSize}–${gpu.subgroupMaxSize}` : undefined],
        ['Software fallback', gpu.isFallbackAdapter],
        ['Preferred canvas format', gpu.preferredCanvasFormat],
    ] : [['Adapter', undefined]])));

    grid.append(card('WebGL', definitionList(device.webgl ? [
        ['Vendor', device.webgl.vendor],
        ['Renderer', device.webgl.renderer],
        ['Version', device.webgl.version],
    ] : [['WebGL', undefined]])));

    const parts: HTMLElement[] = [grid];
    // Identifiers from the code, so they stay as-is
    parts.push(card('Workload constants', definitionList(Object.entries(report.workload), 'report-list code columns'), { wide: true, count: Object.keys(report.workload).length }));
    if (gpu) {
        const features = node('ul', 'report-chips');
        gpu.features.forEach(feature => features.append(node('li', undefined, feature)));
        parts.push(card('WebGPU features', features, { wide: true, count: gpu.features.length }));
        parts.push(card('WebGPU limits', definitionList(Object.entries(gpu.limits), 'report-list code columns'), { wide: true, count: Object.keys(gpu.limits).length }));
    }

    const json = formatJson(report);
    const raw = node('details', 'report-json');
    raw.append(node('summary', undefined, `Exact upload payload (JSON, ${(new Blob([JSON.stringify(report)]).size / 1024).toFixed(1)} KB)`));
    const pre = node('pre', undefined, json);
    pre.id = 'report-json';
    pre.tabIndex = 0;
    raw.append(pre);
    parts.push(raw);

    container.replaceChildren(...parts);
}
