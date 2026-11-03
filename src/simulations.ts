import sponzaPreview from '../img/sponza-preview.jpg';
import type { Resolution } from './renderer';

export interface Simulation {
    id: string;
    name: string;
    category: string;
    summary: string;
    description: string;
    preview: string;
    previewAlt: string;
    source: string;
    camera: { position: [number, number, number]; yaw: number; pitch: number };
}

export const simulations: Simulation[] = [{
    id: 'sponza',
    name: 'Sponza',
    category: 'Architectural scene',
    summary: 'Atrium geometry with moving point lights.',
    description: 'The Sponza atrium brings together detailed geometry, textured materials, and moving point lights. Adjust the light count to explore how your GPU handles a complex lighting workload.',
    preview: sponzaPreview,
    previewAlt: 'Stone arches and colored banners in the Sponza atrium',
    source: `${import.meta.env.BASE_URL}scenes/sponza/Sponza.gltf`,
    camera: { position: [-7, 2, 0], yaw: 0, pitch: 0 },
}];

export const renderResolutions: Record<string, Resolution> = {
    '1080p': { width: 1920, height: 1080 },
    '1440p': { width: 2560, height: 1440 },
    '2160p': { width: 3840, height: 2160 },
};
