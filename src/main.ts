import { simulations, renderResolutions } from './simulations';
import { inspectDevice } from './device';
import type { SimulationSession } from './simulation';
import type { BenchmarkResult } from './testing/benchmark';

const icons = {
    cube: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    play: '<path d="m9 5 11 7-11 7z"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
function icon(name: keyof typeof icons) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }

let selected = simulations[0];
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <aside class="sidebar">
        <a class="brand" href="./" aria-label="RenderRank home"><span class="brand-mark">${icon('cube')}</span>Render<span>Rank</span></a>
        <nav id="scene-nav" aria-label="Scenes"></nav>
        <div class="sidebar-bottom">
            <div class="device-icon">${icon('chip')}</div>
            <div class="device-label">YOUR DEVICE</div>
            <div id="device-name" class="device-name">Checking GPU…</div>
            <dl class="device-details"><div><dt>System</dt><dd id="device-system">—</dd></div><div><dt>Browser</dt><dd id="device-browser">—</dd></div><div><dt>CPU</dt><dd id="device-cores">—</dd></div></dl>
        </div>
    </aside>
    <div class="workspace">
        <header class="topbar"><div>Simulations</div><span id="gpu-status" class="gpu-status"><span class="status-dot"></span>Checking WebGPU</span></header>
        <main id="simulations">
            <div class="page-heading"><div><h1>Simulations</h1><p>Select a scene and configure your run.</p></div><span class="scene-count">${String(simulations.length).padStart(2, '0')} <span>AVAILABLE</span></span></div>
            <div class="simulation-layout">
                <section aria-label="Available simulations"><div id="scene-cards" class="scene-cards"></div>
                    <div class="scene-specs"><div><span>GRAPHICS API</span><strong>WebGPU</strong></div><div><span>RENDERER</span><strong>Clustered deferred</strong></div><div><span>MATERIALS</span><strong>Physically based</strong></div></div>
                </section>
                <section class="configuration" aria-labelledby="config-title">
                    <div class="panel-heading"><span class="eyebrow">SELECTED SIMULATION</span><span class="small-dot"></span></div>
                    <h2 id="config-title">Sponza</h2><p id="scene-type" class="config-subtitle">Architectural scene</p>
                    <div class="divider"></div>
                    <label class="field-label" for="resolution">Render resolution</label>
                    <select id="resolution">${Object.entries(renderResolutions).map(([name, value]) => `<option value="${name}">${name} · ${value.width} × ${value.height}</option>`).join('')}</select>
                    <div class="light-heading"><label class="field-label" for="lights">Point lights</label><output id="light-value" for="lights">500</output></div>
                    <input id="lights" type="range" min="1" max="5000" step="1" value="500"><div class="range-labels"><span>1</span><span>5,000</span></div>
                    <div class="run-actions"><button id="run" class="button primary">${icon('play')}Run benchmark</button><button id="preview" class="button secondary">Preview scene${icon('arrow')}</button></div>
                    <p class="run-note">Benchmark tests 500–5,000 lights at the selected resolution. The light slider applies to preview.</p>
                    <div id="compatibility" class="compatibility" role="status" hidden></div>
                </section>
            </div>
            <section class="scene-information" aria-labelledby="about-heading"><div><span class="eyebrow">ABOUT THE SCENE</span><h2 id="about-heading">Sponza atrium</h2></div><p id="scene-description"></p></section>
            <section id="results" class="results" aria-labelledby="results-heading" hidden><div class="results-heading"><div><span class="eyebrow">LAST RUN</span><h2 id="results-heading">Sponza results</h2></div><button id="download" class="button secondary compact">${icon('download')}Export CSV</button></div><p id="result-settings" class="result-settings"></p><div class="table-scroll"><table><thead><tr><th>Point lights</th><th>Avg. frame time</th><th>Min.</th><th>Max.</th></tr></thead><tbody id="result-rows"></tbody></table></div><p class="run-note">Display-paced frame times are limited by refresh rate. These are diagnostic measurements, not GPU throughput scores.</p></section>
            <footer><span>RenderRank</span><span>Browser-based GPU benchmarking</span></footer>
        </main>
    </div>
    <dialog id="viewer" aria-labelledby="viewer-title"><div class="viewer-shell"><div class="viewer-toolbar"><button id="close-viewer" class="button secondary compact">${icon('back')}Back</button><div class="viewer-title"><strong id="viewer-title">Sponza</strong><span id="viewer-mode">Preview</span></div><span id="live-metrics" class="live-metrics"></span></div><div class="canvas-wrap"><canvas id="mainCanvas" tabindex="0" aria-label="Interactive Sponza scene"></canvas><div id="loading" class="loading" role="status"><span class="spinner"></span><span id="loading-message">Loading Sponza…</span></div></div><div class="viewer-footer"><span id="viewer-help">W A S D to move · Q / E up and down · Hold mouse to look</span><span id="benchmark-progress" role="status"></span></div></div></dialog>
`;

const run = element<HTMLButtonElement>('run');
const preview = element<HTMLButtonElement>('preview');
const resolution = element<HTMLSelectElement>('resolution');
const lights = element<HTMLInputElement>('lights');
const viewer = element<HTMLDialogElement>('viewer');
const canvas = element<HTMLCanvasElement>('mainCanvas');
let session: SimulationSession | undefined;
let initializing: Promise<SimulationSession> | undefined;
let controller: AbortController | undefined;
let busy = false;
let failed = false;
let results: BenchmarkResult[] = [];
let resultResolution = '';
let resultScene = selected;

function selectSimulation(id: string) {
    if (busy) return;
    if (selected.id !== id) {
        session?.destroy();
        session = undefined;
        initializing = undefined;
    }
    selected = simulations.find(scene => scene.id === id)!;
    element('config-title').textContent = selected.name;
    element('scene-type').textContent = selected.category;
    element('scene-description').textContent = selected.description;
    element('about-heading').textContent = selected.name;
    document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => {
        const active = button.dataset.scene === id;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('selected', active);
    });
}
element('scene-cards').innerHTML = simulations.map(scene => `<button class="scene-card" data-scene="${scene.id}" aria-pressed="true"><div class="scene-image"><img src="${scene.preview}" alt="${scene.previewAlt}"><span class="scene-number">SCENE ${String(simulations.indexOf(scene) + 1).padStart(2, '0')}</span><span class="selection-indicator">${icon('check')}Selected</span></div><div class="scene-card-body"><div><span class="eyebrow">${scene.category}</span><h2>${scene.name}</h2><p>${scene.summary}</p></div><span class="scene-card-arrow">${icon('arrow')}</span></div></button>`).join('');
element('scene-nav').innerHTML = simulations.map(scene => `<button class="scene-nav" data-scene="${scene.id}" aria-pressed="true"><span class="scene-nav-dot"></span>${scene.name}</button>`).join('');
document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => button.addEventListener('click', () => selectSimulation(button.dataset.scene!)));
selectSimulation(selected.id);
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
    function displayDevice(adapter?: GPUAdapter) {
        const device = inspectDevice(adapter);
        element('device-name').textContent = device.gpu;
        element('device-system').textContent = device.system;
        element('device-browser').textContent = device.browser;
        element('device-cores').textContent = device.cores;
    }
    try {
        if (!navigator.gpu) throw new Error('WebGPU is unavailable. Open this page in a WebGPU-compatible browser such as Chrome or Edge.');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error('No compatible GPU was found. Check that hardware acceleration is enabled in your browser.');
        displayDevice(adapter);
        element('gpu-status').innerHTML = '<span class="status-dot ready"></span>WebGPU ready';
    } catch (error) {
        displayDevice();
        element('gpu-status').innerHTML = '<span class="status-dot unavailable"></span>WebGPU unavailable';
        showCompatibility((error as Error).message);
        run.disabled = preview.disabled = true;
    }
}
void checkGpu();

async function openSimulation(benchmark: boolean) {
    if (busy || failed) return;
    busy = true;
    controller = new AbortController();
    const signal = controller.signal;
    viewer.showModal();
    element('viewer-title').textContent = selected.name;
    element('viewer-mode').textContent = benchmark ? 'Benchmark' : 'Preview';
    element('benchmark-progress').textContent = '';
    element('live-metrics').textContent = '';
    element('loading').hidden = false;
    element('loading-message').textContent = `Loading ${selected.name}…`;
    element('viewer-help').textContent = benchmark ? 'Testing 10 light counts · Keep this tab visible · Back to stop' : 'W A S D to move · Q / E up and down · Hold mouse to look';
    try {
        initializing ??= import('./simulation').then(module => module.createSimulation(canvas, selected, message => {
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
        session.setMetricsCallback((fps, frameTime) => {
            element('live-metrics').textContent = `${fps.toFixed(0)} FPS  /  ${frameTime.toFixed(1)} ms`;
        });
        element('loading').hidden = true;
        session.start(!benchmark);
        canvas.focus();
        if (benchmark) {
            const runResolution = resolution.value;
            const captured = await session.benchmark(signal, message => {
                element('benchmark-progress').textContent = message;
            });
            if (signal.aborted) return;
            results = captured;
            resultScene = selected;
            resultResolution = runResolution;
            element('results-heading').textContent = `${resultScene.name} results`;
            element('result-rows').innerHTML = results.map(row => `<tr><td>${row.numLights.toLocaleString()}</td><td>${row.avgFrameTimeMs.toFixed(2)} <span>ms</span></td><td>${row.minFrameTimeMs.toFixed(2)} <span>ms</span></td><td>${row.maxFrameTimeMs.toFixed(2)} <span>ms</span></td></tr>`).join('');
            element('result-settings').textContent = `${selected.name} · ${resultResolution} · Clustered deferred · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            element('results').hidden = false;
            closeViewer();
            element('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    viewer.close();
    if (session && !session.isBenchmarkRunning()) busy = false;
}
run.addEventListener('click', () => void openSimulation(true));
preview.addEventListener('click', () => void openSimulation(false));
element('close-viewer').addEventListener('click', closeViewer);
viewer.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
element('download').addEventListener('click', () => {
    const csv = ['Scene,Resolution,Number of Lights,Average Frame Time (ms),Min Frame Time (ms),Max Frame Time (ms)', ...results.map(row => `${resultScene.name},${resultResolution},${row.numLights},${row.avgFrameTimeMs.toFixed(3)},${row.minFrameTimeMs.toFixed(3)},${row.maxFrameTimeMs.toFixed(3)}`)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `renderrank-${resultScene.id}-${resultResolution}-${Date.now()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
