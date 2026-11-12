import sponzaPreview from '../img/sponza-preview.jpg';
import orreryPreview from '../img/orrery-preview.jpg';
import type { Resolution } from './renderer';

interface SimulationBase {
    id: string;
    name: string;
    category: string;
    summary: string;
    description: string;
    preview: string;
    previewAlt: string;
    renderer: string;   // shown in the scene specs and result summary
    materials: string;
    runNote: string;
    previewHelp: string;
    benchmarkHelp: string;
    resultLabel: string; // first column of the results table
    resultNote: string;  // how to read the numbers
    // A stress test option: the benchmark looped back to back, reported as frame-rate stability. Only for scenes
    // whose benchmark measures uncapped throughput; a display-paced one would always look stable.
    stress?: {
        defaultLoops: number; // the loop count field starts here; people can change it
        loopSeconds: number;  // length of one loop, for the time estimate
        resultNote: string;   // how to read the per-loop table
    };
}

// Point lights in Sponza's benchmark. Part of the workload, so it is also listed in the shader constants (and so in
// every report); changing it makes old results incomparable.
export const sponzaBenchmarkLights = 8000;

// The preview light slider's top: enough to preview the benchmark's load
export const maxPointLights = Math.max(5000, sponzaBenchmarkLights);

// Loop counts the stress test accepts, and the stability it needs to pass: the lowest loop score must be at least this
// fraction of the highest
export const stressLoopRange = { min: 2, max: 100 };
export const stabilityPassMark = 0.97;

// A glTF scene drawn by the clustered deferred renderer, with a free camera and a light-count sweep
export interface GltfSimulation extends SimulationBase {
    kind: 'gltf';
    source: string;
    camera: { position: [number, number, number]; yaw: number; pitch: number };
}

// A scene generated entirely in shaders, with its own fixed camera timeline
export interface ProceduralSimulation extends SimulationBase {
    kind: 'procedural';
}

export type Simulation = GltfSimulation | ProceduralSimulation;

// Display order: library cards, the sidebar, and the default selection all follow this array
export const simulations: Simulation[] = [{
    id: 'orrery',
    name: 'Orrery',
    category: 'Procedural scene',
    summary: 'A ray-marched rotunda with no meshes or textures.',
    description: 'Every surface in the Orrery is a signed distance function evaluated per pixel: a domed hall, sixteen columns, and a brass mechanism of nested rings turning around a glowing core. Soft shadows from two lights, ambient occlusion, mirror reflections, and a shadowed shaft of sunlight are all traced in one fragment shader, so the load scales directly with resolution. The camera follows a fixed 40-second path through four shots.',
    preview: orreryPreview,
    previewAlt: 'Brass rings around a glowing core under a dome, lit by a shaft of sunlight',
    renderer: 'Ray-marched SDF',
    materials: 'Procedural',
    runNote: 'Benchmark plays the 40-second camera path once, uncapped, and gives a score. Preview loops it at the display rate.',
    previewHelp: 'Fixed camera path · Loops every 40 seconds',
    benchmarkHelp: 'Playing 4 shots · Keep this tab visible · Back to stop',
    resultLabel: 'Shot',
    resultNote: 'Frame times are from uncapped offscreen rendering; Min. and Max. are the best and worst quarter-second averages. GPU pass times, where shown, come from browser timestamp queries, which the browser rounds. Scores are not yet ranked against other devices.',
    stress: {
        defaultLoops: 20,
        loopSeconds: 40, // timelineDuration in src/procedural/orrery_timeline.ts
        resultNote: 'Each loop plays the whole camera path. A loop’s score is computed as in the benchmark, and its average frame time is the mean of its four shots’ averages; Min. and Max. are the best and worst quarter-second averages in the loop. GPU pass times, where shown, come from browser timestamp queries.',
    },
    kind: 'procedural',
}, {
    id: 'sponza',
    name: 'Sponza',
    category: 'Architectural scene',
    summary: 'Atrium geometry with moving point lights.',
    description: 'The Sponza atrium brings together detailed geometry, textured materials, and moving point lights. The benchmark flies a fixed 40-second camera path through the courtyard, the arcades, and the upper gallery while the lights follow fixed paths, so every run renders the same frames. In preview, fly the camera yourself and change the light count.',
    preview: sponzaPreview,
    previewAlt: 'Stone arches and colored banners in the Sponza atrium',
    renderer: 'Clustered deferred',
    materials: 'Physically based',
    runNote: `Benchmark plays the 40-second camera path once with ${sponzaBenchmarkLights.toLocaleString('en-US')} moving lights, uncapped, and gives a score. The light slider applies only to preview.`,
    previewHelp: 'W A S D to move · Q / E up and down · Hold mouse to look',
    benchmarkHelp: 'Playing 4 shots · Keep this tab visible · Back to stop',
    resultLabel: 'Shot',
    resultNote: 'Frame times are from uncapped offscreen rendering; Min. and Max. are the best and worst quarter-second averages. GPU times, where shown, cover light clustering, the G-buffer, and lighting, and come from browser timestamp queries, which the browser rounds. Scores are not yet ranked against other devices.',
    stress: {
        defaultLoops: 20,
        loopSeconds: 40, // sponzaTimeline's duration in src/stage/sponza_timeline.ts
        resultNote: 'Each loop plays the whole camera path. A loop’s score is computed as in the benchmark, and its average frame time is the mean of its four shots’ averages; Min. and Max. are the best and worst quarter-second averages in the loop. GPU times, where shown, come from browser timestamp queries.',
    },
    kind: 'gltf',
    source: `${import.meta.env.BASE_URL}scenes/sponza/Sponza.gltf`,
    camera: { position: [-7, 2, 0], yaw: 0, pitch: 0 },
}];

export const renderResolutions: Record<string, Resolution> = {
    '1080p': { width: 1920, height: 1080 },
    '1440p': { width: 2560, height: 1440 },
    '2160p': { width: 3840, height: 2160 },
};
