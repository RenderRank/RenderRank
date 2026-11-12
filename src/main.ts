import { simulations, renderResolutions } from './simulations';
import type { Simulation } from './simulations';
import { collectDeviceReport, inspectDevice } from './device';
import type { SimulationSession } from './simulation';
import type { BenchmarkResult, BenchmarkScore } from './testing/benchmark';
import { mountFrameChart, Sparkline } from './ui/frame_chart';
import type { FrameSample, Segment } from './ui/frame_chart';
import { constants as shaderConstants } from './shaders/shaders';
import { accountsEnabled, currentAccount, onAccountChange, renderSignInButton, signOut } from './auth';

const icons = {
    cube: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    play: '<path d="m9 5 11 7-11 7z"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
};
function icon(name: keyof typeof icons) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

// A finished benchmark, kept until the next one replaces it
interface CompletedRun {
    scene: Simulation;
    resolution: string;
    finishedAt: Date;
    rows: BenchmarkResult[];
    score?: BenchmarkScore;
    samples: FrameSample[];
    segments: Segment[];
    uploadedId?: string;
}

// The app is three screens, one visible at a time, chosen by the URL hash:
//   #/              library: pick a scene
//   #/scene/<id>    setup: that scene's settings, preview, and run
//   #/results       results of the last benchmark
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
                        <div id="light-settings"><div class="light-heading"><label class="field-label" for="lights">Point lights</label><output id="light-value" for="lights">500</output></div>
                        <input id="lights" type="range" min="1" max="5000" step="1" value="500"><div class="range-labels"><span>1</span><span>5,000</span></div></div>
                        <div class="run-actions"><button id="run" class="button primary">${icon('play')}Run benchmark</button><button id="preview" class="button secondary">Preview scene${icon('arrow')}</button></div>
                        <p id="run-note" class="run-note"></p>
                        <a id="last-result" class="last-result" href="#/results" hidden>View last result${icon('arrow')}</a>
                    </section>
                </div>
            </section>

            <section id="view-results" aria-labelledby="results-heading" hidden>
                <a class="back-link" id="results-back" href="#/">${icon('back')}Back to scene</a>
                <div class="results-heading"><div><h1 id="results-heading">Results</h1><p id="result-settings" class="result-settings"></p></div>
                    <div class="result-actions"><button id="run-again" class="button secondary compact">${icon('play')}Run again</button><button id="download" class="button secondary compact">${icon('download')}Export CSV</button><button id="upload" class="button primary compact">${icon('upload')}<span>Upload score</span></button></div></div>
                <p id="upload-status" class="upload-status" role="status" hidden></p>
                <div id="score" class="score" hidden><span class="eyebrow" id="score-label">SCORE</span><strong id="score-value"></strong><span id="score-detail"></span><p id="score-note" class="run-note"></p></div>
                <h2 class="section-title">Frame time over the run</h2>
                <div id="frame-chart" class="frame-chart"></div>
                <h2 class="section-title" id="table-title">By segment</h2>
                <div class="table-scroll"><table><thead><tr><th id="result-label">Point lights</th><th>Avg. frame time</th><th>Min.</th><th>Max.</th><th id="result-gpu" hidden>Avg. GPU pass</th></tr></thead><tbody id="result-rows"></tbody></table></div>
                <p id="result-note" class="run-note"></p>
            </section>

            <footer><span>RenderRank</span><span>Browser-based GPU benchmarking</span></footer>
        </main>
    </div>
    <dialog id="viewer" aria-labelledby="viewer-title"><div class="viewer-shell"><div class="viewer-toolbar"><button id="close-viewer" class="button secondary compact">${icon('back')}Back</button><div class="viewer-title"><strong id="viewer-title"></strong><span id="viewer-mode">Preview</span></div><div class="live"><canvas id="live-graph" class="live-graph" role="img" aria-label="Recent frame times"></canvas><span id="live-metrics" class="live-metrics"></span></div></div><div class="canvas-wrap"><canvas id="mainCanvas" tabindex="0"></canvas><div id="loading" class="loading" role="status"><span class="spinner"></span><span id="loading-message"></span></div></div><div class="viewer-footer"><span id="viewer-help"></span><span id="benchmark-progress" role="status"></span></div></div></dialog>
`;

const run = element<HTMLButtonElement>('run');
const preview = element<HTMLButtonElement>('preview');
const resolution = element<HTMLSelectElement>('resolution');
const lights = element<HTMLInputElement>('lights');
const viewer = element<HTMLDialogElement>('viewer');
const canvas = element<HTMLCanvasElement>('mainCanvas');
const upload = element<HTMLButtonElement>('upload');
const uploadLabel = upload.querySelector('span')!;
const sparkline = new Sparkline(element<HTMLCanvasElement>('live-graph'));

let selected = simulations[0];
let session: SimulationSession | undefined;
let initializing: Promise<SimulationSession> | undefined;
let controller: AbortController | undefined;
let busy = false;
let failed = false;
let adapter: GPUAdapter | undefined;
let lastRun: CompletedRun | undefined;
let unmountChart: (() => void) | undefined;

// ---------------------------------------------------------------------------------------------------------------------
// Screens

function selectSimulation(scene: Simulation) {
    if (selected.id !== scene.id) {
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
    element('run-note').textContent = scene.runNote;
    element('light-settings').hidden = scene.kind !== 'gltf';
    const image = element<HTMLImageElement>('scene-image');
    image.src = scene.preview;
    image.alt = scene.previewAlt;
    element('last-result').hidden = lastRun?.scene.id !== scene.id;
}

function showScreen() {
    const [, view, id] = location.hash.split('/');
    const scene = simulations.find(candidate => candidate.id === id);
    const screen = view === 'scene' && scene ? 'scene' : view === 'results' && lastRun ? 'results' : 'library';

    // A different scene can't take over while one is running
    if (screen === 'scene' && !busy) selectSimulation(scene!);

    element('view-library').hidden = screen !== 'library';
    element('view-scene').hidden = screen !== 'scene';
    element('view-results').hidden = screen !== 'results';
    element('breadcrumb').textContent = screen === 'library' ? 'Simulations'
        : screen === 'scene' ? `Simulations / ${selected.name}`
        : `Simulations / ${lastRun!.scene.name} / Results`;

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
    return message.match(/^Testing with (\d+) lights/)?.[1].replace(/\B(?=(\d{3})+$)/g, ',')
        ?? message.match(/^Shot \d+ of \d+ · (.+)$/)?.[1];
}

async function openSimulation(benchmark: boolean) {
    if (busy || failed) return;
    busy = true;
    controller = new AbortController();
    const signal = controller.signal;
    const scene = selected;
    viewer.showModal();
    element('viewer-title').textContent = scene.name;
    element('viewer-mode').textContent = benchmark ? 'Benchmark' : 'Preview';
    element('benchmark-progress').textContent = '';
    element('live-metrics').textContent = '';
    element('loading').hidden = false;
    element('loading-message').textContent = `Loading ${scene.name}…`;
    element('viewer-help').textContent = benchmark ? scene.benchmarkHelp : scene.previewHelp;
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

        // Every sample feeds the live graph; during a benchmark they are also kept for the results screen
        const samples: FrameSample[] = [];
        const segments: Segment[] = [];
        let runStart: number | undefined;
        session.setSampleCallback(frameTime => {
            sparkline.push(frameTime);
            if (runStart !== undefined) samples.push({ tMs: performance.now() - runStart, frameTimeMs: frameTime });
        });

        element('loading').hidden = true;
        session.start(!benchmark);
        canvas.focus();
        if (benchmark) {
            const runResolution = resolution.value;
            const captured = await session.benchmark(signal, message => {
                element('benchmark-progress').textContent = message;
                const label = segmentLabel(message);
                if (label !== undefined) {
                    // The clock starts with the first segment, so warm-up isn't part of the graph
                    runStart ??= performance.now();
                    segments.push({ tMs: performance.now() - runStart, label });
                }
            });
            if (signal.aborted) return;
            lastRun = { scene, resolution: runResolution, finishedAt: new Date(), rows: captured.rows, score: captured.score, samples, segments };
            element('nav-results').hidden = false;
            closeViewer();
            if (location.hash === '#/results') showScreen(); else location.hash = '#/results';
        }
    } catch (error) {
        if (!signal.aborted) {
            showCompatibility(`Unable to start the simulation. ${(error as Error).message}`);
            closeViewer();
            if (!session) initializing = undefined;
        }
    } finally {
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

function renderResults() {
    const result = lastRun!;
    element<HTMLAnchorElement>('results-back').href = `#/scene/${result.scene.id}`;
    element('results-heading').textContent = `${result.scene.name} results`;
    element('result-settings').textContent = `${result.resolution} · ${result.scene.renderer} · ${result.finishedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    element('score').hidden = !result.score;
    if (result.score) {
        element('score-label').textContent = `${result.scene.name.toUpperCase()} ${result.resolution.toUpperCase()} SCORE`;
        element('score-value').textContent = result.score.valid ? result.score.value.toLocaleString() : '—';
        element('score-detail').textContent = result.score.valid ? `${result.score.averageFps.toFixed(1)} FPS average across shots` : '';
        element('score-note').textContent = result.score.note;
    }

    unmountChart?.();
    unmountChart = mountFrameChart(element('frame-chart'), result.samples, result.segments);

    const hasGpuTimes = result.rows.some(row => row.avgGpuTimeMs !== undefined);
    const ms = (value: number) => Number.isFinite(value) ? `${value.toFixed(2)} <span>ms</span>` : '—';
    element('table-title').textContent = `By ${result.scene.resultLabel.toLowerCase()}`;
    element('result-label').textContent = result.scene.resultLabel;
    element('result-gpu').hidden = !hasGpuTimes;
    element('result-rows').innerHTML = result.rows.map(row => `<tr><td>${row.label}</td><td>${ms(row.avgFrameTimeMs)}</td><td>${ms(row.minFrameTimeMs)}</td><td>${ms(row.maxFrameTimeMs)}</td>${hasGpuTimes ? `<td>${ms(row.avgGpuTimeMs ?? NaN)}</td>` : ''}</tr>`).join('');
    element('result-note').textContent = result.scene.resultNote;

    upload.disabled = result.uploadedId !== undefined;
    uploadLabel.textContent = result.uploadedId ? 'Uploaded' : 'Upload score';
    const status = element('upload-status');
    status.hidden = !result.uploadedId;
    status.textContent = result.uploadedId ? `Saved on the server as ${result.uploadedId}` : '';
}

element('run-again').addEventListener('click', () => {
    if (!lastRun || busy) return;
    resolution.value = lastRun.resolution;
    location.hash = `#/scene/${lastRun.scene.id}`;
    // The hash change selects the scene; start once that has happened
    setTimeout(() => void openSimulation(true));
});

element('download').addEventListener('click', () => {
    if (!lastRun) return;
    const { scene, resolution: runResolution, rows, score } = lastRun;
    const firstColumn = scene.kind === 'gltf' ? 'Number of Lights' : scene.resultLabel;
    const number = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? '' : value.toFixed(3);
    const lines = [`Scene,Resolution,${firstColumn},Average Frame Time (ms),Min Frame Time (ms),Max Frame Time (ms),Average GPU Pass Time (ms),Score`,
        ...rows.map(row => `${scene.name},${runResolution},${row.numLights ?? row.label},${number(row.avgFrameTimeMs)},${number(row.minFrameTimeMs)},${number(row.maxFrameTimeMs)},${number(row.avgGpuTimeMs)},`)];
    if (score) {
        lines.push(`${scene.name},${runResolution},Overall,${number(1000 / score.averageFps)},,,,${score.valid ? score.value : 'invalid'}`);
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `renderrank-${scene.id}-${runResolution}-${Date.now()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Sends the whole run, with everything the browser reveals about the device, to this site's server
upload.addEventListener('click', async () => {
    const result = lastRun;
    if (!result || result.uploadedId) return;
    const status = element('upload-status');
    upload.disabled = true;
    uploadLabel.textContent = 'Uploading…';
    status.hidden = true;
    try {
        const finite = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? Number(value.toFixed(4)) : null;
        const body = {
            schemaVersion: 1,
            finishedAt: result.finishedAt.toISOString(),
            page: location.origin + location.pathname,
            scene: { id: result.scene.id, name: result.scene.name, kind: result.scene.kind, renderer: result.scene.renderer },
            settings: { resolution: result.resolution, ...renderResolutions[result.resolution] },
            // The constants that define the workload, so results from different versions can be told apart
            workload: shaderConstants,
            score: result.score ?? null,
            rows: result.rows.map(row => ({
                label: row.label,
                numLights: row.numLights ?? null,
                avgFrameTimeMs: finite(row.avgFrameTimeMs),
                minFrameTimeMs: finite(row.minFrameTimeMs),
                maxFrameTimeMs: finite(row.maxFrameTimeMs),
                avgGpuTimeMs: finite(row.avgGpuTimeMs),
            })),
            segments: result.segments.map(segment => ({ tMs: Math.round(segment.tMs), label: segment.label })),
            // Parallel arrays keep the frame-time series compact
            frameTimes: {
                tMs: result.samples.map(sample => Math.round(sample.tMs)),
                frameTimeMs: result.samples.map(sample => Number(sample.frameTimeMs.toFixed(3))),
            },
            device: await collectDeviceReport(adapter),
        };
        const response = await fetch(`${import.meta.env.BASE_URL}api/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
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
    if (lastRun === result && !element('view-results').hidden) renderResults();
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
