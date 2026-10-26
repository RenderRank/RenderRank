// CHECKITOUT: code that you add here will be prepended to all shaders

struct Light {
    pos: vec3f,
    color: vec3f
}

struct LightSet {
    numLights: u32,
    lights: array<Light>
}

// Clustering structures
struct AABB {
    minPos: vec3f,
    maxPos: vec3f
}

// A light that survived frustum culling, with its position already in view space
struct VisibleLight {
    viewPos: vec3f,
    lightIdx: u32 // index into lightSet.lights
}

// Reset to zero at the start of every frame's clustering
struct ClusteringCounters {
    visibleLightCount: atomic<u32>,
    lightIndexCount: atomic<u32>, // indices requested, which can exceed the list's capacity
    overflow: atomic<u32>         // 1 if any cluster dropped lights because the list was full
}

// Light grid entry for each cluster
struct LightGridEntry {
    offset: u32,   // offset into global light index list
    count: u32     // number of lights in this cluster
}

struct CameraUniforms {
    viewProjMat: mat4x4f,
    invProjMat: mat4x4f,
    viewMat: mat4x4f,
    screenWidth: f32,
    screenHeight: f32,
    nearPlane: f32,
    farPlane: f32,
    cameraPos: vec3f, // world space
    invViewProjMat: mat4x4f
}

const PI = 3.14159265359;

// World position of a pixel from its depth-buffer value (WebGPU NDC: x, y in [-1, 1] with y up; depth in [0, 1])
fn reconstructWorldPos(fragCoord: vec2f, depth: f32, screenSize: vec2f, invViewProj: mat4x4f) -> vec3f {
    let uv = fragCoord / screenSize;
    let ndc = vec4f(uv.x * 2.f - 1.f, 1.f - uv.y * 2.f, depth, 1.f);
    let world = invViewProj * ndc;
    return world.xyz / world.w;
}

// Octahedral normal encoding (Cigolle et al. 2014): folds the unit sphere onto a square, so a normal fits in two
// unorm channels with nearly uniform precision in every direction
fn octWrap(v: vec2f) -> vec2f {
    return (1.f - abs(v.yx)) * select(vec2f(-1.f), vec2f(1.f), v >= vec2f(0.f));
}

fn encodeOctahedral(n: vec3f) -> vec2f {
    var p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
    if (n.z < 0.f) {
        p = octWrap(p);
    }
    return p * 0.5f + 0.5f;
}

fn decodeOctahedral(encoded: vec2f) -> vec3f {
    let f = encoded * 2.f - 1.f;
    var n = vec3f(f, 1.f - abs(f.x) - abs(f.y));
    let t = clamp(-n.z, 0.f, 1.f);
    n.x += select(t, -t, n.x >= 0.f);
    n.y += select(t, -t, n.y >= 0.f);
    return normalize(n);
}

// CHECKITOUT: this special attenuation function ensures lights don't affect geometry outside the maximum light radius
fn rangeAttenuation(distance: f32) -> f32 {
    return clamp(1.f - pow(distance / ${lightRadius}, 4.f), 0.f, 1.f) / (distance * distance);
}

// GGX / Trowbridge-Reitz normal distribution; alpha is perceptual roughness squared
fn distributionGgx(NdotH: f32, alpha: f32) -> f32 {
    let alpha2 = alpha * alpha;
    let denom = NdotH * NdotH * (alpha2 - 1.f) + 1.f;
    return alpha2 / (PI * denom * denom);
}

// Height-correlated Smith visibility for GGX. Includes the 1 / (4 NdotL NdotV) of the Cook-Torrance denominator.
fn visibilitySmithGgxCorrelated(NdotV: f32, NdotL: f32, alpha: f32) -> f32 {
    let alpha2 = alpha * alpha;
    let ggxV = NdotL * sqrt(NdotV * NdotV * (1.f - alpha2) + alpha2);
    let ggxL = NdotV * sqrt(NdotL * NdotL * (1.f - alpha2) + alpha2);
    return 0.5f / (ggxV + ggxL);
}

// Metallic-roughness PBR for one point light: Lambert diffuse plus GGX specular, with Schlick Fresnel. Light color has
// pi folded in (the usual real-time convention), so a white Lambert surface facing a light reflects color * attenuation.
fn calculateLightContrib(light: Light, posWorld: vec3f, nor: vec3f, viewDir: vec3f,
                         albedo: vec3f, metallic: f32, roughness: f32) -> vec3f {
    let vecToLight = light.pos - posWorld;
    let distToLight = length(vecToLight);
    let lightDir = vecToLight / distToLight;
    let halfDir = normalize(lightDir + viewDir);

    let NdotL = max(dot(nor, lightDir), 0.f);
    let NdotV = max(dot(nor, viewDir), 1e-4f);
    let NdotH = max(dot(nor, halfDir), 0.f);
    let VdotH = max(dot(viewDir, halfDir), 0.f);

    let alpha = roughness * roughness;
    let f0 = mix(vec3f(0.04f), albedo, metallic);
    let fresnel = f0 + (1.f - f0) * pow(1.f - VdotH, 5.f);

    let specular = distributionGgx(NdotH, alpha) * visibilitySmithGgxCorrelated(NdotV, NdotL, alpha) * fresnel;
    let diffuse = (1.f - fresnel) * (1.f - metallic) * albedo / PI;

    return (diffuse + specular) * PI * light.color * NdotL * rangeAttenuation(distToLight);
}

// Clustering utility functions
fn screenToView(screenCoord: vec2f, depth: f32, invProj: mat4x4f) -> vec3f {
    let ndc = vec4f(screenCoord.x, screenCoord.y, depth, 1.0);

    var viewPos = invProj * ndc;
    viewPos = viewPos / viewPos.w;

    return viewPos.xyz;
}

fn getClusterIndex(fragCoord: vec4f, viewZ: f32, screenWidth: f32, screenHeight: f32, nearPlane: f32, farPlane: f32) -> u32 {
    let clusterX = u32(floor(fragCoord.x / (screenWidth / f32(${clusterWidth}))));
    let clusterY = u32(floor(fragCoord.y / (screenHeight / f32(${clusterHeight}))));

    let zNear = nearPlane;
    let zFar = farPlane;
    let viewDepth = -viewZ; // view space Z is negative

    // Exponential depth slicing: slice = log(z/near) / log(far/near) * numSlices
    let clusterZ = u32(floor(log(viewDepth / zNear) / log(zFar / zNear) * f32(${clusterDepth})));
    let clusterZClamped = clamp(clusterZ, 0u, ${clusterDepth} - 1u);

    let clusterIdx = clusterX +
                     clusterY * ${clusterWidth} +
                     clusterZClamped * ${clusterWidth} * ${clusterHeight};

    return clusterIdx;
}

fn getDepthSliceBounds(sliceIdx: u32, nearPlane: f32, farPlane: f32) -> vec2f {
    // Exponential depth distribution
    let zNear = nearPlane;
    let zFar = farPlane;
    let ratio = zFar / zNear;

    let near = zNear * pow(ratio, f32(sliceIdx) / f32(${clusterDepth}));
    let far = zNear * pow(ratio, f32(sliceIdx + 1u) / f32(${clusterDepth}));

    return vec2f(near, far);
}
