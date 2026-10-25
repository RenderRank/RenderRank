import Stats from 'stats.js';
import { GUI } from 'dat.gui';

import { GpuContext } from './gpu/context';
import { ClusteredDeferredRenderer } from './renderers/clustered_deferred';
import { DisplayDriver } from './drivers/display_driver';

import { setupLoaders, Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { BenchmarkRunner } from './testing/benchmark';

// Replaces the whole page with a message, for when WebGPU can't run at all
function showFatalError(message: string) {
    const errorMessageElement = document.createElement("h1");
    errorMessageElement.textContent = message;
    errorMessageElement.style.paddingLeft = '0.4em';
    document.body.innerHTML = '';
    document.body.appendChild(errorMessageElement);
}

const canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;
const gpu = await GpuContext.create(canvas).catch((error: Error) => {
    showFatalError(error.message);
    throw error;
});
setupLoaders();

let scene = new Scene(gpu);
await scene.loadGltf('./scenes/sponza/Sponza.gltf');

// Frames always render at this size and get scaled to fit the canvas, so window size doesn't change the workload
const renderResolution = { width: 1920, height: 1080 };

const camera = new Camera(gpu, renderResolution);
const lights = new Lights(gpu, camera);

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const gui = new GUI();
gui.add(lights, 'numLights').min(1).max(Lights.maxNumLights).step(1).onChange(() => {
    lights.updateLightSetUniformNumLights();
});

const stage = new Stage(gpu, renderResolution, scene, lights, camera, stats);

const renderer = new ClusteredDeferredRenderer(stage);
const driver = new DisplayDriver(stage, renderer);
driver.start();

// Every GPU resource dies with the device, so stop drawing and tell the user instead of showing a frozen frame
gpu.lost.then((info) => {
    driver.stop();
    showFatalError(`The GPU device was lost (${info.message || info.reason}). Reload the page to try again.`);
});

// Setup benchmark runner
const benchmarkRunner = new BenchmarkRunner(stage, driver);

// Add progress display element
const progressDiv = document.createElement('div');
progressDiv.id = 'benchmark-progress';
progressDiv.style.position = 'fixed';
progressDiv.style.top = '50%';
progressDiv.style.left = '50%';
progressDiv.style.transform = 'translate(-50%, -50%)';
progressDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
progressDiv.style.color = 'white';
progressDiv.style.padding = '20px';
progressDiv.style.borderRadius = '10px';
progressDiv.style.fontFamily = 'monospace';
progressDiv.style.fontSize = '14px';
progressDiv.style.display = 'none';
progressDiv.style.zIndex = '1000';
progressDiv.style.maxWidth = '600px';
progressDiv.style.maxHeight = '400px';
progressDiv.style.overflow = 'auto';
document.body.appendChild(progressDiv);

// Setup benchmark callbacks
benchmarkRunner.setProgressCallback((message: string) => {
    progressDiv.style.display = 'block';
    progressDiv.innerHTML += message + '<br>';
    progressDiv.scrollTop = progressDiv.scrollHeight;
});

benchmarkRunner.setCompleteCallback((results) => {
    progressDiv.innerHTML += '<br><strong>Benchmark complete! Downloading CSV...</strong><br>';
    setTimeout(() => {
        benchmarkRunner.downloadCSV(`benchmark_results_${Date.now()}.csv`);
        setTimeout(() => {
            progressDiv.style.display = 'none';
            progressDiv.innerHTML = '';
        }, 2000);
    }, 1000);
});

// Add benchmark button to GUI
const benchmarkControls = {
    startBenchmark: () => {
        if (benchmarkRunner.isTestRunning()) {
            alert('Benchmark is already running!');
            return;
        }
        if (confirm('This will run automated performance tests with different light counts. This may take several minutes. Continue?')) {
            progressDiv.innerHTML = '<strong>Starting benchmark...</strong><br>';
            progressDiv.style.display = 'block';
            // Start benchmark after a short delay to let UI update
            setTimeout(() => {
                benchmarkRunner.runBenchmark();
            }, 100);
        }
    }
};

gui.add(benchmarkControls, 'startBenchmark').name('Start Testing');
