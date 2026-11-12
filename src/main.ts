import { simulations, renderResolutions, stabilityPassMark, stressLoopRange } from './simulations';
import type { Simulation } from './simulations';
import { inspectDevice } from './device';
import type { SimulationSession } from './simulation';
import { mountFrameChart, Sparkline } from './ui/frame_chart';
import type { FrameSample, Segment } from './ui/frame_chart';
import { buildRunReport } from './report';
import type { RunMeasurements, RunReport } from './report';
import { formatJson, renderReport } from './ui/report_view';
import { maxReportFileBytes, parseRunReport, reportFileName } from './report_file';
import { accountsEnabled, currentAccount, onAccountChange, renderSignInButton, signOut } from './auth';

const icons = {
    cube: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    play: '<path d="m9 5 11 7-11 7z"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    file: '<path d="M14 3H6v18h12V7zm0 0v4h4M9 13h6m-6 4h6"/>',
};
function icon(name: keyof typeof icons) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

// What the results screen shows: the last benchmark run in this tab, or a report opened from a file, whichever came
// last. The screen is drawn from the report alone, so an opened report looks exactly as it did when its run finished.
interface ShownResult {
    report: RunReport;
    file?: string;        // name of the file it was opened from
    uploadedId?: string;  // set once the server saved it
}

// The app is three screens, one visible at a time, chosen by the URL hash:
//   #/              library: pick a scene
//   #/scene/<id>    setup: that scene's settings, preview, and run
//   #/results       results of the last benchmark, or of a report opened from a file
// The viewer dialog sits on top of the setup screen while a scene is running.
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <aside class="sidebar">
        <a class="brand" href="#/" aria-label="RenderRank home"><span class="brand-mark">${icon('cube')}</span>Render<span>Rank</span></a>
        <nav id="scene-nav" aria-label="Scenes">
            <a class="scene-nav" id="nav-library" href="#/"><span class="scene-nav-dot"></span>All simulations</a>
            ${simulations.map(scene => `<a class="scene-nav nested" data-scene="${scene.id}" href="#/scene/${scene.id}"><span class="scene-nav-dot"></span>${scene.name}</a>`).join('')}
            <a class="scene-nav" id="nav-results" href="#/results" hidden><span class="scene-nav-dot"></span>Results</a>
        </nav>
        <div class="sidebar-bottom">
            <div class="device-icon">${icon('chip')}</div>
            <div class="device-label">YOUR DEVICE</div>
            <div id="device-name" class="device-name">Checking GPU…</div>
            <dl class="device-details"><div><dt>System</dt><dd id="device-system">—</dd></div><div><dt>Browser</dt><dd id="device-browser">—</dd></div><div><dt>CPU</dt><dd id="device-cores">—</dd></div></dl>
        </div>
    </aside>
    <div class="workspace">
        <header class="topbar"><div id="breadcrumb">Simulations</div><div class="topbar-end">
            <div id="account" class="account" hidden>
                <span id="account-email" class="account-email"></span>
                <button id="sign-in" class="button secondary compact" aria-expanded="false" aria-controls="sign-in-panel">Sign in</button>
                <button id="sign-out" class="button secondary compact" hidden>Sign out</button>
                <div id="sign-in-panel" class="sign-in-panel" role="dialog" aria-label="Sign in" hidden><p>Sign in with your Google account.</p><div id="google-button" class="google-button"></div><p id="sign-in-status" class="sign-in-status" role="status"></p></div>
            </div>
            <span id="gpu-status" class="gpu-status"><span class="status-dot"></span>Checking WebGPU</span></div></header>
        <main>
            <div id="compatibility" class="compatibility" role="status" hidden></div>

            <section id="view-library" aria-labelledby="library-heading">
                <div class="page-heading"><div><h1 id="library-heading">Simulations</h1><p>Choose a scene to set up a run.</p></div><span class="scene-count">${String(simulations.length).padStart(2, '0')} <span>AVAILABLE</span></span></div>
                <div class="scene-cards">${simulations.map((scene, i) => `<a class="scene-card" data-scene="${scene.id}" href="#/scene/${scene.id}"><div class="scene-image"><img src="${scene.preview}" alt="${scene.previewAlt}"><span class="scene-number">SCENE ${String(i + 1).padStart(2, '0')}</span></div><div class="scene-card-body"><div><span class="eyebrow">${scene.category}</span><h2>${scene.name}</h2><p>${scene.summary}</p></div><span class="scene-card-arrow">${icon('arrow')}</span></div></a>`).join('')}</div>
                <section id="open-report" class="open-report" aria-labelledby="open-report-title">
                    <div class="open-report-text"><h2 id="open-report-title">Saved report</h2><p>Open a run report saved with Export JSON to see its results again. You can also drop the file here.</p></div>
                    <button id="open-report-button" class="button secondary compact">${icon('file')}Open report</button>
                    <input id="report-file" type="file" accept=".json,application/json" hidden>
                    <p id="open-report-status" class="open-report-status" role="alert" hidden></p>
                </section>
            </section>

            <section id="view-scene" aria-labelledby="scene-heading" hidden>
                <a class="back-link" href="#/">${icon('back')}All simulations</a>
                <div class="page-heading"><div><h1 id="scene-heading"></h1><p id="scene-type"></p></div></div>
                <div class="simulation-layout">
                    <div>
                        <div class="scene-image framed"><img id="scene-image" alt=""></div>
                        <div class="scene-specs"><div><span>GRAPHICS API</span><strong>WebGPU</strong></div><div><span>RENDERER</span><strong id="spec-renderer"></strong></div><div><span>MATERIALS</span><strong id="spec-materials"></strong></div></div>
                        <p id="scene-description" class="scene-description"></p>
                    </div>
                    <section class="configuration" aria-labelledby="config-title">
                        <span class="eyebrow" id="config-title">RUN SETTINGS</span>
                        <label class="field-label first" for="resolution">Render resolution</label>
                        <select id="resolution">${Object.entries(renderResolutions).map(([name, value]) => `<option value="${name}">${name} · ${value.width} × ${value.height}</option>`).join('')}</select>
                        <div id="test-settings"><label class="field-label" for="test-mode">Test</label>
                        <select id="test-mode"><option value="benchmark">Benchmark · one pass</option><option value="stress">Stress test · looped</option></select></div>
                        <div id="loop-settings" hidden><label class="field-label" for="loops">Loops</label>
                        <input id="loops" class="number-input" type="number" min="${stressLoopRange.min}" max="${stressLoopRange.max}" step="1" inputmode="numeric" value=""></div>
                        <div id="light-settings"><div class="light-heading"><label class="field-label" for="lights">Point lights</label><output id="light-value" for="lights">500</output></div>
                        <input id="lights" type="range" min="1" max="5000" step="1" value="500"><div class="range-labels"><span>1</span><span>5,000</span></div></div>
                        <div class="run-actions"><button id="run" class="button primary">${icon('play')}<span id="run-label">Run benchmark</span></button><button id="preview" class="button secondary">Preview scene${icon('arrow')}</button></div>
                        <p id="run-note" class="run-note"></p>
                        <a id="last-result" class="last-result" href="#/results" hidden>View last result${icon('arrow')}</a>
                    </section>
                </div>
            </section>

            <section id="view-results" aria-labelledby="results-heading" hidden>
                <a class="back-link" id="results-back" href="#/">${icon('back')}Back to scene</a>
                <div class="results-heading"><div><h1 id="results-heading">Results</h1><p id="result-settings" class="result-settings"></p></div>
                    <div class="result-actions"><button id="run-again" class="button secondary compact">${icon('play')}Run again</button><button id="download" class="button secondary compact">${icon('download')}Export JSON</button><button id="upload" class="button primary compact">${icon('upload')}<span>Upload score</span></button></div></div>
                <p id="upload-status" class="upload-status" role="status" hidden></p>
                <div id="score" class="score" hidden><span class="eyebrow" id="score-label">SCORE</span><strong id="score-value"></strong><span id="score-detail"></span><p id="score-note" class="run-note"></p></div>
                <h2 class="section-title">Frame time over the run</h2>
                <div id="frame-chart" class="frame-chart"></div>
                <h2 class="section-title" id="table-title">By segment</h2>
                <div class="table-scroll"><table><thead><tr><th id="result-label">Point lights</th><th id="result-score" hidden>Score</th><th>Avg. frame time</th><th>Min.</th><th>Max.</th><th id="result-gpu" hidden>Avg. GPU pass</th></tr></thead><tbody id="result-rows"></tbody></table></div>
                <p id="result-note" class="run-note"></p>
                <h2 class="section-title">Run report</h2>
                <p class="run-note report-intro">Export JSON saves, and Upload score sends, exactly this report: the score, frame times, and table above, and every detail below. It contains no IP address, language, or time zone.</p>
                <div id="report" class="report"></div>
            </section>

            <footer><span>RenderRank</span><span>Browser-based GPU benchmarking</span></footer>
        </main>
    </div>
    <dialog id="viewer" aria-labelledby="viewer-title"><div class="viewer-shell"><div class="viewer-toolbar"><button id="close-viewer" class="button secondary compact">${icon('back')}Back</button><div class="viewer-title"><strong id="viewer-title"></strong><span id="viewer-mode">Preview</span></div><div class="live"><figure class="live-chart"><figcaption>Frame time</figcaption><div class="live-chart-plot"><span id="live-graph-axis" class="live-chart-axis" aria-hidden="true"></span><canvas id="live-graph" class="live-graph" role="img" aria-label="Recent frame times"></canvas></div></figure><span id="live-metrics" class="live-metrics"></span></div></div><div class="canvas-wrap"><canvas id="mainCanvas" tabindex="0"></canvas><div id="loading" class="loading" role="status"><span class="spinner"></span><span id="loading-message"></span></div></div><div class="viewer-footer"><span id="viewer-help"></span><span id="benchmark-progress" role="status"></span></div></div></dialog>
`;

const run = element<HTMLButtonElement>('run');
const preview = element<HTMLButtonElement>('preview');
const resolution = element<HTMLSelectElement>('resolution');
const testMode = element<HTMLSelectElement>('test-mode');
const loopsInput = element<HTMLInputElement>('loops');
const lights = element<HTMLInputElement>('lights');
const viewer = element<HTMLDialogElement>('viewer');
const canvas = element<HTMLCanvasElement>('mainCanvas');
const upload = element<HTMLButtonElement>('upload');
const uploadLabel = upload.querySelector('span')!;
const sparkline = new Sparkline(element<HTMLCanvasElement>('live-graph'), element('live-graph-axis'));

let selected = simulations[0];
let session: SimulationSession | undefined;
let initializing: Promise<SimulationSession> | undefined;
let controller: AbortController | undefined;
let busy = false;
let failed = false;
let adapter: GPUAdapter | undefined;
let shown: ShownResult | undefined;
let unmountChart: (() => void) | undefined;

// ---------------------------------------------------------------------------------------------------------------------
// Screens

function selectSimulation(scene: Simulation) {
    const changed = selected.id !== scene.id;
    if (changed) {
        session?.destroy();
        session = undefined;
        initializing = undefined;
    }
    selected = scene;
    element('scene-heading').textContent = scene.name;
    element('scene-type').textContent = `${scene.category} · ${scene.summary}`;
    element('scene-description').textContent = scene.description;
    element('spec-renderer').textContent = scene.renderer;
    element('spec-materials').textContent = scene.materials;
    element('light-settings').hidden = scene.kind !== 'gltf';
    element('test-settings').hidden = !scene.stress;
    if (!scene.stress) testMode.value = 'benchmark';
    else if (changed || loopsInput.value === '') loopsInput.value = String(scene.stress.defaultLoops);
    updateRunMode();
    const image = element<HTMLImageElement>('scene-image');
    image.src = scene.preview;
    image.alt = scene.previewAlt;
    element('last-result').hidden = shown?.report.scene.id !== scene.id;
}

function stressSelected() {
    return testMode.value === 'stress' && selected.stress !== undefined;
}

// The loop count field, held to the accepted range; an empty or unreadable entry means the scene's default
function stressLoops(): number {
    const value = Math.round(Number(loopsInput.value));
    if (loopsInput.value.trim() === '' || !Number.isFinite(value)) return selected.stress?.defaultLoops ?? stressLoopRange.min;
    return Math.min(stressLoopRange.max, Math.max(stressLoopRange.min, value));
}

function updateRunMode() {
    const stress = stressSelected() ? selected.stress! : undefined;
    element('loop-settings').hidden = !stress;
    element('run-label').textContent = stress ? 'Run stress test' : 'Run benchmark';
    if (!stress) {
        element('run-note').textContent = selected.runNote;
        return;
    }
    const loops = stressLoops();
    const seconds = loops * stress.loopSeconds;
    const length = seconds < 90 ? `${seconds} seconds` : `about ${Math.round(seconds / 60)} minutes`;
    element('run-note').textContent = `Stress test runs the ${stress.loopSeconds}-second benchmark ${loops} times back to back, which takes ${length}. `
        + `It reports frame-rate stability: the lowest loop score as a percentage of the highest. ${stabilityPassMark * 100}% or more passes.`;
}
testMode.addEventListener('change', updateRunMode);
loopsInput.addEventListener('input', updateRunMode);
// Shows the count that will actually run once editing is done
loopsInput.addEventListener('change', () => {
    loopsInput.value = String(stressLoops());
    updateRunMode();
});

function showScreen() {
    const [, view, id] = location.hash.split('/');
    const scene = simulations.find(candidate => candidate.id === id);
    const screen = view === 'scene' && scene ? 'scene' : view === 'results' && shown ? 'results' : 'library';

    // A different scene can't take over while one is running
    if (screen === 'scene' && !busy) selectSimulation(scene!);

    element('view-library').hidden = screen !== 'library';
    element('view-scene').hidden = screen !== 'scene';
    element('view-results').hidden = screen !== 'results';
    element('breadcrumb').textContent = screen === 'library' ? 'Simulations'
        : screen === 'scene' ? `Simulations / ${selected.name}`
        : `Simulations / ${shown!.report.scene.name} / Results`;

    element('nav-library').classList.toggle('selected', screen === 'library');
    element('nav-results').classList.toggle('selected', screen === 'results');
    document.querySelectorAll<HTMLElement>('.scene-nav[data-scene]').forEach(link => {
        const active = screen === 'scene' && link.dataset.scene === selected.id;
        link.classList.toggle('selected', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });

    if (screen === 'results') renderResults();
    window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showScreen);

lights.addEventListener('input', () => {
    element('light-value').textContent = Number(lights.value).toLocaleString();
    lights.style.setProperty('--range-progress', `${(Number(lights.value) - 1) / 4999 * 100}%`);
});

function showCompatibility(message: string) {
    const notice = element('compatibility');
    notice.textContent = message;
    notice.hidden = false;
}

async function checkGpu() {
    function displayDevice() {
        const device = inspectDevice(adapter);
        element('device-name').textContent = device.gpu;
        element('device-system').textContent = device.system;
        element('device-browser').textContent = device.browser;
        element('device-cores').textContent = device.cores;
    }
    try {
        if (!navigator.gpu) throw new Error('WebGPU is unavailable. Open this page in a WebGPU-compatible browser such as Chrome or Edge.');
        adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }) ?? undefined;
        if (!adapter) throw new Error('No compatible GPU was found. Check that hardware acceleration is enabled in your browser.');
        displayDevice();
        element('gpu-status').innerHTML = '<span class="status-dot ready"></span>WebGPU ready';
    } catch (error) {
        displayDevice();
        element('gpu-status').innerHTML = '<span class="status-dot unavailable"></span>WebGPU unavailable';
        showCompatibility((error as Error).message);
        run.disabled = preview.disabled = true;
    }
}
void checkGpu();

// ---------------------------------------------------------------------------------------------------------------------
// Running a scene

// Turns a benchmark progress message into the label of the segment it starts, if it starts one
function segmentLabel(message: string): string | undefined {
    const loop = message.match(/^Loop (\d+) of \d+/);
    if (loop) return `Loop ${loop[1]}`;
    return message.match(/^Testing with (\d+) lights/)?.[1].replace(/\B(?=(\d{3})+$)/g, ',')
        ?? message.match(/^Shot \d+ of \d+ · (.+)$/)?.[1];
}

async function openSimulation(benchmark: boolean) {
    if (busy || failed) return;
    busy = true;
    controller = new AbortController();
    const signal = controller.signal;
    const scene = selected;
    const loops = benchmark && stressSelected() ? stressLoops() : 1;
    // Keeps the display awake during a run: a display that sleeps hides the tab, which invalidates the result
    let wakeLock: WakeLockSentinel | undefined;
    viewer.showModal();
    element('viewer-title').textContent = scene.name;
    element('viewer-mode').textContent = !benchmark ? 'Preview' : loops > 1 ? 'Stress test' : 'Benchmark';
    element('benchmark-progress').textContent = '';
    element('live-metrics').textContent = '';
    element('loading').hidden = false;
    element('loading-message').textContent = `Loading ${scene.name}…`;
    element('viewer-help').textContent = !benchmark ? scene.previewHelp : loops > 1 ? `Looping ${loops} times · Keep this tab visible · Back to stop` : scene.benchmarkHelp;
    canvas.setAttribute('aria-label', `${scene.name} scene`);
    sparkline.clear();
    try {
        initializing ??= import('./simulation').then(module => module.createSimulation(canvas, scene, message => {
            failed = true;
            controller?.abort();
            session?.stop();
            showCompatibility(message);
            viewer.close();
            run.disabled = preview.disabled = true;
            busy = false;
        }));
        session = await initializing;
        if (signal.aborted) return;
        session.configure(resolution.value, Number(lights.value));
        session.setMetricsCallback((fps, frameTime, gpuTime) => {
            element('live-metrics').textContent = `${fps.toFixed(0)} FPS  /  ${frameTime.toFixed(1)} ms` + (gpuTime === undefined ? '' : `  ·  GPU ${gpuTime.toFixed(1)} ms`);
        });

        // Every sample feeds the live graph; during a benchmark they are also kept for the results screen. A stress
        // test keeps one averaged point per quarter second, so even a 100-loop report stays under the upload size limit.
        const samples: FrameSample[] = [];
        const segments: Segment[] = [];
        const pointSpacingMs = loops > 1 ? 250 : 0;
        let runStart: number | undefined;
        let point = { startMs: 0, sum: 0, count: 0 };
        session.setSampleCallback(frameTime => {
            sparkline.push(frameTime);
            if (runStart === undefined) return;
            const tMs = performance.now() - runStart;
            point.sum += frameTime;
            point.count++;
            if (tMs - point.startMs >= pointSpacingMs) {
                samples.push({ tMs, frameTimeMs: point.sum / point.count });
                point = { startMs: tMs, sum: 0, count: 0 };
            }
        });

        element('loading').hidden = true;
        session.start(!benchmark);
        canvas.focus();
        if (benchmark) {
            const runResolution = resolution.value;
            wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined);
            const captured = await session.benchmark(signal, message => {
                element('benchmark-progress').textContent = message;
                const label = segmentLabel(message);
                // A stress test reports every shot of every loop; the graph marks only where each loop starts
                if (label !== undefined && label !== segments[segments.length - 1]?.label) {
                    // The clock starts with the first segment, so warm-up isn't part of the graph
                    runStart ??= performance.now();
                    segments.push({ tMs: performance.now() - runStart, label });
                }
            }, loops);
            if (signal.aborted) return;
            const measurements: RunMeasurements = { scene, resolution: runResolution, finishedAt: new Date(), rows: captured.rows, score: captured.score, stress: captured.stress, samples, segments };
            const report = await buildRunReport(measurements, adapter);
            closeViewer();
            // Shown as its JSON round trip, which is exactly what Export JSON saves and an opened file gives back
            showResult({ report: JSON.parse(JSON.stringify(report)) as RunReport });
        }
    } catch (error) {
        if (!signal.aborted) {
            showCompatibility(`Unable to start the simulation. ${(error as Error).message}`);
            closeViewer();
            if (!session) initializing = undefined;
        }
    } finally {
        void wakeLock?.release().catch(() => {});
        if (!viewer.open) busy = false;
    }
}

function closeViewer() {
    controller?.abort();
    session?.stop();
    session?.setSampleCallback(null);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    viewer.close();
    if (session && !session.isBenchmarkRunning()) busy = false;
}
run.addEventListener('click', () => void openSimulation(true));
preview.addEventListener('click', () => void openSimulation(false));
element('close-viewer').addEventListener('click', closeViewer);
viewer.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });

// ---------------------------------------------------------------------------------------------------------------------
// Results

function showResult(result: ShownResult) {
    shown = result;
    element('nav-results').hidden = false;
    if (location.hash === '#/results') showScreen(); else location.hash = '#/results';
}

function msCell(value: number | null): HTMLTableCellElement {
    const cell = document.createElement('td');
    if (value === null) {
        cell.textContent = '—';
    } else {
        const unit = document.createElement('span');
        unit.textContent = 'ms';
        cell.append(`${value.toFixed(2)} `, unit);
    }
    return cell;
}

// Draws the results screen from the report alone. Scene text that isn't part of the report (table heading, notes)
// comes from the catalog; a report from a scene this page doesn't have gets neutral wording.
function renderResults() {
    const { report, file, uploadedId } = shown!;
    const scene = simulations.find(candidate => candidate.id === report.scene.id);
    const resultLabel = report.stress ? 'Loop' : scene?.resultLabel ?? 'Segment';
    const back = element<HTMLAnchorElement>('results-back');
    back.href = scene ? `#/scene/${scene.id}` : '#/';
    back.lastChild!.textContent = scene ? 'Back to scene' : 'All simulations';
    element('results-heading').textContent = `${report.scene.name} results`;
    element('result-settings').textContent = `${report.settings.resolution} · ${report.scene.renderer} · ${new Date(report.finishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    const { score, stress } = report;
    element('run-again').hidden = !scene || !(report.settings.resolution in renderResolutions) || (stress !== undefined && !scene.stress);

    element('score').hidden = !score && !stress;
    if (stress) {
        element('score-label').textContent = `${report.scene.name.toUpperCase()} ${report.settings.resolution.toUpperCase()} STRESS TEST`;
        // Rounded down, so a run just under the pass mark never shows as reaching it
        element('score-value').textContent = stress.valid ? `${(Math.floor(stress.stability * 1000 + 1e-6) / 10).toFixed(1)}%` : '—';
        element('score-detail').textContent = stress.valid
            ? `frame-rate stability · ${stress.passed ? 'Passed' : 'Did not pass'} · loop scores ${Math.min(...stress.loopScores).toLocaleString()}–${Math.max(...stress.loopScores).toLocaleString()}`
            : '';
        element('score-note').textContent = stress.note;
    } else if (score) {
        element('score-label').textContent = `${report.scene.name.toUpperCase()} ${report.settings.resolution.toUpperCase()} SCORE`;
        element('score-value').textContent = score.valid ? score.value.toLocaleString() : '—';
        element('score-detail').textContent = score.valid ? `${score.averageFps.toFixed(1)} FPS average across shots` : '';
        element('score-note').textContent = score.note;
    }

    unmountChart?.();
    const samples: FrameSample[] = report.frameTimes.tMs.map((tMs, i) => ({ tMs, frameTimeMs: report.frameTimes.frameTimeMs[i] }));
    unmountChart = mountFrameChart(element('frame-chart'), samples, report.segments);

    const hasGpuTimes = report.rows.some(row => row.avgGpuTimeMs !== null);
    element('table-title').textContent = `By ${resultLabel.toLowerCase()}`;
    element('result-label').textContent = resultLabel;
    element('result-gpu').hidden = !hasGpuTimes;
    element('result-score').hidden = !stress;
    element('result-rows').replaceChildren(...report.rows.map((row, i) => {
        const tr = document.createElement('tr');
        const label = document.createElement('td');
        label.textContent = row.label;
        tr.append(label);
        if (stress) {
            const loopScore = document.createElement('td');
            loopScore.textContent = stress.loopScores[i]?.toLocaleString() ?? '—';
            tr.append(loopScore);
        }
        tr.append(msCell(row.avgFrameTimeMs), msCell(row.minFrameTimeMs), msCell(row.maxFrameTimeMs));
        if (hasGpuTimes) tr.append(msCell(row.avgGpuTimeMs));
        return tr;
    }));
    element('result-note').textContent = (stress ? scene?.stress?.resultNote : scene?.resultNote) ?? '';
    renderReport(element('report'), report);

    // An opened report can't be uploaded from here; Upload score is for runs measured in this tab
    upload.hidden = file !== undefined;
    upload.disabled = uploadedId !== undefined;
    uploadLabel.textContent = uploadedId ? 'Uploaded' : 'Upload score';
    const status = element('upload-status');
    status.textContent = [file && `Opened from ${file}`, uploadedId && `Saved on the server as ${uploadedId}`].filter(Boolean).join(' · ');
    status.hidden = status.textContent === '';
}

element('run-again').addEventListener('click', () => {
    if (!shown || busy) return;
    const { report } = shown;
    const scene = simulations.find(candidate => candidate.id === report.scene.id);
    if (!scene || !(report.settings.resolution in renderResolutions)) return;
    location.hash = `#/scene/${scene.id}`;
    // The hash change selects the scene; then the run's settings apply and it starts
    setTimeout(() => {
        resolution.value = report.settings.resolution;
        testMode.value = report.stress ? 'stress' : 'benchmark';
        if (report.stress) loopsInput.value = String(report.stress.loops);
        updateRunMode();
        void openSimulation(true);
    });
});

// Saves the report exactly as the results screen prints it; Open report reads it back
element('download').addEventListener('click', () => {
    if (!shown) return;
    const url = URL.createObjectURL(new Blob([formatJson(shown.report)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFileName(shown.report);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Sends the run report shown on the results screen, unchanged, to this site's server
upload.addEventListener('click', async () => {
    const result = shown;
    if (!result || result.file !== undefined || result.uploadedId) return;
    const status = element('upload-status');
    upload.disabled = true;
    uploadLabel.textContent = 'Uploading…';
    status.hidden = true;
    try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result.report),
        });
        const reply = await response.json().catch(() => undefined) as { id?: string; error?: string } | undefined;
        if (!response.ok || !reply?.id) {
            throw new Error(reply?.error ?? (response.status === 404 || response.status === 405 ? 'This site has no result storage.' : `The server answered ${response.status}.`));
        }
        result.uploadedId = reply.id;
    } catch (error) {
        status.textContent = `Upload failed. ${(error as Error).message}`;
        status.hidden = false;
        upload.disabled = false;
        uploadLabel.textContent = 'Upload score';
        return;
    }
    if (shown === result && !element('view-results').hidden) renderResults();
});

// ---------------------------------------------------------------------------------------------------------------------
// Opening a saved report (library screen)

const reportFile = element<HTMLInputElement>('report-file');
const openReport = element('open-report');

async function openReportFile(file: File) {
    const status = element('open-report-status');
    status.hidden = true;
    try {
        if (file.size > maxReportFileBytes) throw new Error('It is too large to be a run report.');
        const { report, uploadedId } = parseRunReport(await file.text());
        showResult({ report, file: file.name, uploadedId });
    } catch (error) {
        status.textContent = `Couldn’t open ${file.name}. ${(error as Error).message}`;
        status.hidden = false;
    }
}

element('open-report-button').addEventListener('click', () => reportFile.click());
reportFile.addEventListener('change', () => {
    const file = reportFile.files?.[0];
    // Cleared so choosing the same file again still opens it
    reportFile.value = '';
    if (file) void openReportFile(file);
});
openReport.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    openReport.classList.add('dragging');
});
openReport.addEventListener('dragleave', event => {
    if (!openReport.contains(event.relatedTarget as Node)) openReport.classList.remove('dragging');
});
openReport.addEventListener('drop', event => {
    event.preventDefault();
    openReport.classList.remove('dragging');
    const file = event.dataTransfer?.files[0];
    if (file) void openReportFile(file);
});

showScreen();

// ---------------------------------------------------------------------------------------------------------------------
// Account

const signInButton = element<HTMLButtonElement>('sign-in');
const signInPanel = element('sign-in-panel');

function renderAccount(account = currentAccount()) {
    element('account').hidden = !accountsEnabled;
    signInButton.hidden = account !== undefined;
    element('sign-out').hidden = account === undefined;
    element('account-email').textContent = account?.email ?? '';
    element('account-email').title = account?.name ?? '';
    if (account) closeSignIn();
}

function closeSignIn() {
    signInPanel.hidden = true;
    signInButton.setAttribute('aria-expanded', 'false');
}

// Google's button lives in a small panel, so Google's script loads only for people who choose to sign in
async function openSignIn() {
    const status = element('sign-in-status');
    const slot = element('google-button');
    signInPanel.hidden = false;
    signInButton.setAttribute('aria-expanded', 'true');
    status.textContent = '';
    // Once drawn, Google's button stays in the panel for the next opening
    if (slot.querySelector(':not(.google-button-loading)')) return;
    // The loading note sits in the button's own fixed-height slot, so the button replaces it without resizing the panel
    slot.hidden = false;
    slot.innerHTML = '<span class="google-button-loading">Loading Google sign-in…</span>';
    try {
        await renderSignInButton(slot, message => { status.textContent = message; });
    } catch (error) {
        slot.replaceChildren();
        slot.hidden = true;
        status.textContent = (error as Error).message;
    }
}

signInButton.addEventListener('click', () => { if (signInPanel.hidden) void openSignIn(); else closeSignIn(); });
element('sign-out').addEventListener('click', () => { signOut(); signInButton.focus(); });
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !signInPanel.hidden) { closeSignIn(); signInButton.focus(); }
});
document.addEventListener('click', event => {
    if (!signInPanel.hidden && !element('account').contains(event.target as Node)) closeSignIn();
});
onAccountChange(account => renderAccount(account));
renderAccount();
