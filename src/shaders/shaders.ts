// CHECKITOUT: this file loads all the shaders and preprocesses them with some common code

import { Camera } from '../stage/camera';

import commonRaw from './common.wgsl?raw';

import fullscreenVertRaw from './fullscreen.vs.wgsl?raw';
import blitFragRaw from './blit.fs.wgsl?raw';

import clusteredDeferredVertRaw from './clustered_deferred.vs.wgsl?raw';
import clusteredDeferredFragRaw from './clustered_deferred.fs.wgsl?raw';
import clusteredDeferredFullscreenFragRaw from './clustered_deferred_fullscreen.fs.wgsl?raw';

import tonemapFragRaw from './tonemap.fs.wgsl?raw';

import moveLightsComputeRaw from './move_lights.cs.wgsl?raw';
import clusterBoundsComputeRaw from './cluster_bounds.cs.wgsl?raw';
import lightCullingComputeRaw from './light_culling.cs.wgsl?raw';
import lightAssignmentComputeRaw from './light_assignment.cs.wgsl?raw';

// CONSTANTS (for use in shaders)
// =================================

// CHECKITOUT: feel free to add more constants here and to refer to them in your shader code

// Note that these are declared in a somewhat roundabout way because otherwise minification will drop variables
// that are unused in host side code.
export const constants = {
    bindGroup_scene: 0,
    bindGroup_model: 1,
    bindGroup_material: 2,

    moveLightsWorkgroupSize: 128,

    lightRadius: 2,

    // Clustering constants
    clusterWidth: 16,
    clusterHeight: 9,
    clusterDepth: 24,
    clusteringWorkgroupSize: 64, // 1D, one cluster per invocation; also the light batch size in shared memory
    lightCullingWorkgroupSize: 128,
    // Capacity of the light index list shared by all clusters (8 MB). Past it, lights get dropped and an overflow flag
    // is set. Sponza's opening view needs ~48k at 500 lights and ~560k at 5000.
    maxClusterLightIndices: 1 << 21,

    // Scales HDR lighting before the tone curve. Tuned by eye for Sponza at the current light intensity.
    toneMappingExposure: 1.7
};

// =================================

// Substitutes ${name} with constants[name]. Not done with eval: Rollup tree-shakes object properties that are only
// referenced from inside an eval'd string, which silently turned e.g. ${lightRadius} into "undefined" in production builds.
function evalShaderRaw(raw: string) {
    return raw.replace(/\$\{(\w+)\}/g, (_, name: string) => String(constants[name as keyof typeof constants]));
}

const commonSrc: string = evalShaderRaw(commonRaw);

function processShaderRaw(raw: string) {
    return commonSrc + evalShaderRaw(raw);
}

export const fullscreenVertSrc: string = processShaderRaw(fullscreenVertRaw);
export const blitFragSrc: string = processShaderRaw(blitFragRaw);

export const clusteredDeferredVertSrc: string = processShaderRaw(clusteredDeferredVertRaw);
export const clusteredDeferredFragSrc: string = processShaderRaw(clusteredDeferredFragRaw);
export const clusteredDeferredFullscreenFragSrc: string = processShaderRaw(clusteredDeferredFullscreenFragRaw);

export const tonemapFragSrc: string = processShaderRaw(tonemapFragRaw);

export const moveLightsComputeSrc: string = processShaderRaw(moveLightsComputeRaw);
export const clusterBoundsComputeSrc: string = processShaderRaw(clusterBoundsComputeRaw);
export const lightCullingComputeSrc: string = processShaderRaw(lightCullingComputeRaw);
export const lightAssignmentComputeSrc: string = processShaderRaw(lightAssignmentComputeRaw);
