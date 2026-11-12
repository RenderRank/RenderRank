// The report for one finished benchmark run. It is built once when the run ends; the results screen displays it and
// Upload score sends it unchanged, so what the page shows is exactly what leaves the browser.
import { collectDeviceReport } from './device';
import type { DeviceReport } from './device';
import { constants as shaderConstants } from './shaders/shaders';
import { renderResolutions } from './simulations';
import type { Simulation } from './simulations';
import type { BenchmarkResult, BenchmarkScore, StressResult } from './testing/benchmark';
import type { FrameSample, Segment } from './ui/frame_chart';

export interface RunReport {
    schemaVersion: 1;
    finishedAt: string;  // ISO 8601
    page: string;        // origin and path of the page that ran it, without the hash
    scene: { id: string; name: string; kind: Simulation['kind']; renderer: string };
    settings: { resolution: string; width: number; height: number };
    // The constants that define the workload, so results from different versions can be told apart
    workload: Record<string, number>;
    score: BenchmarkScore | null;
    // Only in stress tests, where `rows` has one entry per loop and `score` is null. Older reports don't have it.
    stress?: StressResult;
    rows: {
        label: string;
        numLights: number | null;
        avgFrameTimeMs: number | null;
        minFrameTimeMs: number | null;
        maxFrameTimeMs: number | null;
        avgGpuTimeMs: number | null;
    }[];
    segments: { tMs: number; label: string }[];
    // Parallel arrays keep the series compact
    frameTimes: { tMs: number[]; frameTimeMs: number[] };
    device: DeviceReport;
}

export interface RunMeasurements {
    scene: Simulation;
    resolution: string;
    finishedAt: Date;
    rows: BenchmarkResult[];
    score?: BenchmarkScore;
    stress?: StressResult;
    samples: FrameSample[];
    segments: Segment[];
}

// JSON has no Infinity or NaN; a measurement that didn't produce a number is null
function finite(value: number | undefined): number | null {
    return value !== undefined && Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

export async function buildRunReport(run: RunMeasurements, adapter?: GPUAdapter): Promise<RunReport> {
    return {
        schemaVersion: 1,
        finishedAt: run.finishedAt.toISOString(),
        page: location.origin + location.pathname,
        scene: { id: run.scene.id, name: run.scene.name, kind: run.scene.kind, renderer: run.scene.renderer },
        settings: { resolution: run.resolution, ...renderResolutions[run.resolution] },
        workload: { ...shaderConstants },
        score: run.score ?? null,
        stress: run.stress && { ...run.stress, stability: Number(run.stress.stability.toFixed(4)) },
        rows: run.rows.map(row => ({
            label: row.label,
            numLights: row.numLights ?? null,
            avgFrameTimeMs: finite(row.avgFrameTimeMs),
            minFrameTimeMs: finite(row.minFrameTimeMs),
            maxFrameTimeMs: finite(row.maxFrameTimeMs),
            avgGpuTimeMs: finite(row.avgGpuTimeMs),
        })),
        segments: run.segments.map(segment => ({ tMs: Math.round(segment.tMs), label: segment.label })),
        frameTimes: {
            tMs: run.samples.map(sample => Math.round(sample.tMs)),
            frameTimeMs: run.samples.map(sample => Number(sample.frameTimeMs.toFixed(3))),
        },
        device: await collectDeviceReport(adapter),
    };
}
