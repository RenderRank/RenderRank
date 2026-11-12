// What a benchmark run produces. The procedure itself is in throughput.ts.

export interface BenchmarkResult {
    label: string;          // what this row measured: a shot, or a loop in a stress test
    numLights?: number;     // only in results from the old Sponza light sweep
    avgGpuTimeMs?: number;  // GPU time of the main pass, where timestamp queries are available
    avgFrameTimeMs: number;
    minFrameTimeMs: number;
    maxFrameTimeMs: number;
}

// A single number for a whole run, from uncapped throughput
export interface BenchmarkScore {
    value: number;
    averageFps: number; // the frame rate the score is derived from
    valid: boolean;     // false if something made the run meaningless, such as a hidden tab
    note: string;
}

// A stress test: the benchmark played several times back to back. Stability is the slowest loop's frame rate as a
// fraction of the fastest loop's; a run passes at `threshold` or above.
export interface StressResult {
    loops: number;
    loopScores: number[];  // each loop's score, computed as for a single benchmark run
    stability: number;     // 0–1
    threshold: number;
    passed: boolean;
    valid: boolean;
    note: string;
}

export interface BenchmarkRun {
    rows: BenchmarkResult[];  // one per shot; one per loop in a stress test
    score?: BenchmarkScore;
    stress?: StressResult;
}
