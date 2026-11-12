// Reads a run report back from a file, so the results screen can show it again. Accepts the report as Export JSON saves
// it, or a file the upload endpoint saved, which wraps the report as { id, receivedAt, result }.
import type { RunReport } from './report';

// Real reports are tens of kilobytes; the upload endpoint takes at most 512 KB
export const maxReportFileBytes = 4 * 1024 * 1024;

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNumberOrNull = (value: unknown) => value === null || isNumber(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const optional = (value: unknown, test: (value: unknown) => boolean) => value === undefined || test(value);
const all = (value: unknown, test: (value: unknown) => boolean) => Array.isArray(value) && value.every(test);
const allValues = (value: unknown, test: (value: unknown) => boolean) => isObject(value) && Object.values(value).every(test);

// Checks every field the results screen reads, so a report that opens displays completely
function checkReport(data: JsonObject) {
    const problems: string[] = [];
    const need = (condition: boolean, field: string) => { if (!condition) problems.push(field); };

    need(isString(data.finishedAt) && !Number.isNaN(Date.parse(data.finishedAt)), 'finishedAt');
    need(isString(data.page), 'page');
    const scene = data.scene;
    need(isObject(scene) && isString(scene.id) && isString(scene.name) && isString(scene.renderer)
        && (scene.kind === 'gltf' || scene.kind === 'procedural'), 'scene');
    const settings = data.settings;
    need(isObject(settings) && isString(settings.resolution) && isNumber(settings.width) && isNumber(settings.height), 'settings');
    need(allValues(data.workload, isNumber), 'workload');
    const score = data.score;
    need(score === null || (isObject(score) && isNumber(score.value) && isNumber(score.averageFps) && isBoolean(score.valid) && isString(score.note)), 'score');
    need(all(data.rows, row => isObject(row) && isString(row.label) && isNumberOrNull(row.numLights) && isNumberOrNull(row.avgFrameTimeMs)
        && isNumberOrNull(row.minFrameTimeMs) && isNumberOrNull(row.maxFrameTimeMs) && isNumberOrNull(row.avgGpuTimeMs)), 'rows');
    need(all(data.segments, segment => isObject(segment) && isNumber(segment.tMs) && isString(segment.label)), 'segments');
    const frameTimes = data.frameTimes;
    need(isObject(frameTimes) && all(frameTimes.tMs, isNumber) && all(frameTimes.frameTimeMs, isNumber)
        && (frameTimes.tMs as unknown[]).length === (frameTimes.frameTimeMs as unknown[]).length, 'frameTimes');

    const device = data.device;
    if (!isObject(device)) {
        problems.push('device');
    } else {
        const { summary, screen, webgpu, webgl, battery } = device;
        need(isObject(summary) && isString(summary.gpu) && isString(summary.system) && isString(summary.browser) && isString(summary.cores), 'device.summary');
        need(isString(device.userAgent) && isString(device.platform) && isNumber(device.maxTouchPoints) && isBoolean(device.crossOriginIsolated)
            && optional(device.logicalCores, isNumber) && optional(device.deviceMemoryGiB, isNumber) && optional(device.clientHints, isObject), 'device');
        need(isObject(screen) && isNumber(screen.width) && isNumber(screen.height) && isNumber(screen.availableWidth) && isNumber(screen.availableHeight)
            && isNumber(screen.colorDepth) && isNumber(screen.devicePixelRatio) && isBoolean(screen.highDynamicRange), 'device.screen');
        need(webgpu === undefined || (isObject(webgpu) && isString(webgpu.vendor) && isString(webgpu.architecture) && isString(webgpu.device)
            && isString(webgpu.description) && isBoolean(webgpu.isFallbackAdapter) && isString(webgpu.preferredCanvasFormat)
            && optional(webgpu.subgroupMinSize, isNumber) && optional(webgpu.subgroupMaxSize, isNumber)
            && all(webgpu.features, isString) && allValues(webgpu.limits, isNumber)), 'device.webgpu');
        need(webgl === undefined || (isObject(webgl) && isString(webgl.vendor) && isString(webgl.renderer) && isString(webgl.version)), 'device.webgl');
        need(battery === undefined || (isObject(battery) && isBoolean(battery.charging) && isNumber(battery.level)), 'device.battery');
    }
    return problems;
}

export function parseRunReport(text: string): { report: RunReport; uploadedId?: string } {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('It isn’t valid JSON.');
    }
    let uploadedId: string | undefined;
    if (isObject(data) && isString(data.id) && isObject(data.result)) {
        uploadedId = data.id;
        data = data.result;
    }
    if (!isObject(data) || !('schemaVersion' in data)) throw new Error('It isn’t a RenderRank run report.');
    if (data.schemaVersion !== 1) throw new Error(`It uses report version ${String(data.schemaVersion)}, which this page can’t read.`);
    const problems = checkReport(data);
    if (problems.length > 0) throw new Error(`These parts of the report are missing or malformed: ${problems.join(', ')}.`);
    return { report: data as unknown as RunReport, uploadedId };
}

// Named after the run, so saving the same report twice gives the same name
export function reportFileName(report: RunReport): string {
    const safe = (text: string) => text.replace(/[^\w-]+/g, '-');
    return `renderrank-${safe(report.scene.id)}-${safe(report.settings.resolution)}-${safe(report.finishedAt.replace(/\.\d+Z$/, 'Z'))}.json`;
}
