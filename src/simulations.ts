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
}

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
    kind: 'procedural',
}, {
    id: 'sponza',
    name: 'Sponza',
    category: 'Architectural scene',
    summary: 'Atrium geometry with moving point lights.',
    description: 'The Sponza atrium brings together detailed geometry, textured materials, and moving point lights. Adjust the light count to explore how your GPU handles a complex lighting workload.',
    preview: sponzaPreview,
    previewAlt: 'Stone arches and colored banners in the Sponza atrium',
    renderer: 'Clustered deferred',
    materials: 'Physically based',
    runNote: 'Benchmark tests 500–5,000 lights at the selected resolution. The light slider applies to preview.',
    previewHelp: 'W A S D to move · Q / E up and down · Hold mouse to look',
    benchmarkHelp: 'Testing 10 light counts · Keep this tab visible · Back to stop',
    resultLabel: 'Point lights',
    resultNote: 'Display-paced frame times are limited by refresh rate. These are diagnostic measurements, not GPU throughput scores.',
    kind: 'gltf',
    source: `${import.meta.env.BASE_URL}scenes/sponza/Sponza.gltf`,
    camera: { position: [-7, 2, 0], yaw: 0, pitch: 0 },
}];

export const renderResolutions: Record<string, Resolution> = {
    '1080p': { width: 1920, height: 1080 },
    '1440p': { width: 2560, height: 1440 },
    '2160p': { width: 3840, height: 2160 },
};
