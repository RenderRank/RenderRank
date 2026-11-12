// Orrery fragment shader
// A fully procedural scene: every surface is a signed distance function, ray-marched per pixel. There are no meshes
// or textures. All of the frame's cost is in this shader, so it scales with pixel count and stresses fragment
// arithmetic rather than geometry or memory bandwidth.
//
// The scene is a domed rotunda (16 columns, a polished floor, an oculus letting in a shaft of sun) around a brass
// orrery: three nested gimbal rings turning about a glowing core, with planets riding the rings and orbiting the hall.
//
// Per pixel: primary march -> soft shadows for two lights -> ambient occlusion -> one reflection bounce with its own
// shadows -> a shadowed volumetric march through the sun shaft. Every loop has a fixed step cap, so the worst case
// is bounded and identical on every device.

// Matches the buffer written in renderers/orrery.ts
struct Frame {
    camPos: vec3f,
    time: f32,
    camRight: vec3f,
    tanHalfFov: f32,
    camUp: vec3f,
    aspect: f32,
    camForward: vec3f,
    pixelAngle: f32,                // angle one pixel subtends, for filtering procedural patterns
    ringRot: array<mat3x3f, 3>,     // world -> ring-local rotations, animated on the CPU
    planets: array<vec4f, 6>        // xyz center, w radius. 0-2 ride the rings, 3-5 orbit the hall.
}

@group(0) @binding(0) var<uniform> frame: Frame;

const PI = 3.14159265359;

const CENTER = vec3f(0.0, 3.6, 0.0);            // orrery core
const SUN_DIR = vec3f(0.11886, 0.99048, 0.06933);
const SUN_COLOR = vec3f(1.0, 0.9, 0.74) * 7.0;
const CORE_COLOR = vec3f(1.0, 0.5, 0.2);
const CORE_INTENSITY = 24.0;
const CORE_RADIUS = 0.6;
const OCULUS_RADIUS = 1.8;
const DOME_CENTER = vec3f(0.0, 7.9, 0.0);
const DOME_RADIUS = 9.6;
const MAX_DIST = 60.0;

// Material ids. M_BOUND marks a distance to a bounding volume rather than to a surface.
const M_BOUND = 0.0;
const M_FLOOR = 1.0;
const M_MARBLE = 2.0;
const M_PLASTER = 3.0;
const M_STONE = 4.0;
const M_GOLD = 5.0;
const M_STEEL = 6.0;
const M_COPPER = 7.0;
const M_CORE = 8.0;
const M_PLANET = 10.0; // + planet index

// ---------------------------------------------------------------------------------------------------------------------
// Distance functions

fn sdBox2(w: vec2f, b: vec2f) -> f32 {
    let d = abs(w) - b;
    return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

// Upright cylinder between heights y0 and y1
fn sdCylinderY(p: vec3f, r: f32, y0: f32, y1: f32) -> f32 {
    return sdBox2(vec2f(length(p.xz), p.y - 0.5 * (y0 + y1)), vec2f(r, 0.5 * (y1 - y0)));
}

// Flat band bent into a ring in the local XY plane: radius R, half-thickness b.x, half-width b.y
fn sdBand(p: vec3f, R: f32, b: vec2f) -> f32 {
    return sdBox2(vec2f(length(p.xy) - R, p.z), b) - 0.015;
}

// Folds the plane into one 22.5 degree wedge using three mirrors. Mirrors preserve distance, so one column placed in
// the wedge becomes a ring of 16 exact copies with no trigonometry.
fn foldColonnade(q: vec2f) -> vec2f {
    var p = abs(q);
    if (p.y > p.x) {
        p = p.yx;
    }
    let n = vec2f(-0.38268343, 0.92387953);
    p -= 2.0 * max(dot(p, n), 0.0) * n;
    return p;
}

fn opU(a: vec2f, d: f32, id: f32) -> vec2f {
    if (d < a.x) {
        return vec2f(d, id);
    }
    return a;
}

// Returns (distance, material id)
fn map(p: vec3f) -> vec2f {
    var res = vec2f(p.y, M_FLOOR);
    let r = length(p.xz);

    // Colonnade: shaft, base, and capital of one column, mirrored 16 times, plus the ring beam they carry
    let f = foldColonnade(p.xz) - vec2f(8.82707, 1.75581);
    let cp = vec3f(f.x, p.y, f.y);
    var dMarble = sdCylinderY(cp, 0.42, 0.0, 7.0);
    dMarble = min(dMarble, sdCylinderY(cp, 0.6, 0.0, 0.3) - 0.04);
    dMarble = min(dMarble, sdCylinderY(cp, 0.58, 6.65, 7.0) - 0.04);
    dMarble = min(dMarble, sdBox2(vec2f(r - 9.0, p.y - 7.45), vec2f(0.7, 0.45)) - 0.03);
    dMarble = min(dMarble, sdBox2(vec2f(r - 12.0, p.y - 1.1), vec2f(0.14, 0.09)) - 0.02); // wall moulding
    res = opU(res, dMarble, M_MARBLE);

    // Shell: outer wall, ceiling over the ambulatory, and the dome with its oculus cut out
    let dDome = max(7.9 - p.y, DOME_RADIUS - length(p - DOME_CENTER));
    let dShell = min(12.0 - r, max(dDome, OCULUS_RADIUS - r));
    res = opU(res, dShell, M_PLASTER);

    // Orrery pedestal
    var dStone = sdCylinderY(p, 2.4, 0.0, 0.3) - 0.03;
    dStone = min(dStone, sdCylinderY(p, 1.8, 0.3, 0.6) - 0.03);
    dStone = min(dStone, sdCylinderY(p, 0.22, 0.6, 0.95));
    res = opU(res, dStone, M_STONE);

    // Orrery mechanism. Everything in it fits in a sphere of radius 2.95, so outside that sphere the distance to the
    // sphere stands in for the mechanism and its rotations are skipped.
    let q = p - CENTER;
    let dBound = length(q) - 3.0;
    if (dBound > 0.4) {
        res = opU(res, dBound, M_BOUND);
    } else {
        res = opU(res, sdBand(q, 2.75, vec2f(0.05, 0.1)), M_STEEL); // fixed meridian ring
        res = opU(res, sdBand(frame.ringRot[0] * q, 2.3, vec2f(0.045, 0.11)), M_GOLD);
        res = opU(res, sdBand(frame.ringRot[1] * q, 1.85, vec2f(0.04, 0.1)), M_STEEL);
        res = opU(res, sdBand(frame.ringRot[2] * q, 1.4, vec2f(0.04, 0.09)), M_COPPER);
        res = opU(res, length(q) - CORE_RADIUS, M_CORE);
        for (var i = 0; i < 3; i++) {
            res = opU(res, length(p - frame.planets[i].xyz) - frame.planets[i].w, M_PLANET + f32(i));
        }
    }

    for (var i = 3; i < 6; i++) {
        res = opU(res, length(p - frame.planets[i].xyz) - frame.planets[i].w, M_PLANET + f32(i));
    }

    return res;
}

fn calcNormal(p: vec3f, t: f32) -> vec3f {
    // Tetrahedron technique: four map evaluations instead of six
    let e = vec2f(1.0, -1.0) * (0.0004 + 0.0004 * t);
    return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
                     e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

// Returns (hit distance, material id); id is 0 on a miss
fn march(ro: vec3f, rd: vec3f, maxSteps: i32) -> vec2f {
    var t = 0.02;
    for (var i = 0; i < maxSteps; i++) {
        let h = map(ro + rd * t);
        if (h.x < 0.0004 + 0.0006 * t) {
            return vec2f(t, h.y);
        }
        t += h.x;
        if (t > MAX_DIST) {
            break;
        }
    }
    return vec2f(MAX_DIST, 0.0);
}

// Penumbra shadows: the closer a ray passes to an occluder relative to its distance, the darker the result. Two
// successive samples estimate the ray's closest approach between them (after Sebastian Aaltonen), which removes the
// banding a plain per-sample minimum leaves when steps are long.
fn softShadow(ro: vec3f, rd: vec3f, tMax: f32, k: f32, maxSteps: i32) -> f32 {
    var res = 1.0;
    var t = 0.03;
    var prevH = 1e20;
    var reached = false;
    for (var i = 0; i < maxSteps; i++) {
        let h = map(ro + rd * t);
        // A bounding volume is safe to step by but isn't an occluder, so it mustn't darken the penumbra. Neither
        // must the core: it is a light, and rays aimed at it end beside its surface.
        if (h.y > 0.5 && abs(h.y - M_CORE) > 0.5) {
            let y = h.x * h.x / (2.0 * prevH);
            let d = sqrt(max(h.x * h.x - y * y, 0.0));
            res = min(res, k * d / max(t - y, 0.001));
            prevH = h.x;
        } else {
            prevH = 1e20;
        }
        // The minimum step grows with distance so rays grazing a surface can't use up their steps beside it
        t += clamp(h.x, 0.015 + 0.02 * t, 2.5);
        if (res < 0.004) {
            break;
        }
        if (t > tMax) {
            reached = true;
            break;
        }
    }
    // The hall is closed, so a ray that runs out of steps before reaching the light is hugging a surface: a wall
    // lit at a grazing angle, for example. Counting it as lit would paint those walls with light they can't see.
    if (!reached) {
        return 0.0;
    }
    res = clamp(res, 0.0, 1.0);
    return res * res * (3.0 - 2.0 * res);
}

fn ambientOcclusion(p: vec3f, n: vec3f) -> f32 {
    var occ = 0.0;
    var scale = 1.0;
    for (var i = 0; i < ${orreryAoSamples}; i++) {
        let h = 0.02 + 0.5 * f32(i) / f32(${orreryAoSamples} - 1);
        occ += (h - map(p + n * h).x) * scale;
        scale *= 0.75;
    }
    return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Procedural materials

fn hash3(p: vec3f) -> f32 {
    var q = fract(p * 0.3183099 + vec3f(0.1, 0.2, 0.3));
    q *= 17.0;
    return fract(q.x * q.y * q.z * (q.x + q.y + q.z));
}

fn noise3(x: vec3f) -> f32 {
    let i = floor(x);
    var f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i + vec3f(0.0, 0.0, 0.0)), hash3(i + vec3f(1.0, 0.0, 0.0)), f.x),
                   mix(hash3(i + vec3f(0.0, 1.0, 0.0)), hash3(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(hash3(i + vec3f(0.0, 0.0, 1.0)), hash3(i + vec3f(1.0, 0.0, 1.0)), f.x),
                   mix(hash3(i + vec3f(0.0, 1.0, 1.0)), hash3(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

fn fbm(p: vec3f) -> f32 {
    var x = p;
    var a = 0.5;
    var sum = 0.0;
    for (var i = 0; i < 4; i++) {
        sum += a * noise3(x);
        x = x * 2.02 + vec3f(3.1, 1.7, 5.3);
        a *= 0.5;
    }
    return sum;
}

// Vein intensity in [0, 1]: thin lines where a warped noise field crosses its midpoint
fn veins(p: vec3f) -> f32 {
    let w = fbm(p * 0.7 + 2.0 * vec3f(fbm(p * 0.4), fbm(p * 0.4 + 4.7), 0.0));
    return smoothstep(0.014, 0.0, abs(w - 0.47));
}

// Box-filtered checkerboard: the filter width keeps distant tiles from aliasing without any derivatives
fn checker(p: vec2f, w: vec2f) -> f32 {
    let i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
    return 0.5 - 0.5 * i.x * i.y;
}

struct Material {
    albedo: vec3f,
    roughness: f32,
    metallic: f32,
    emissive: vec3f
}

// Materials follow each surface's role. Between them they exercise every shading path: rough dielectrics cover most
// of the hall (diffuse, shadows, occlusion), the polished floor puts mirror reflections over a large part of the
// screen, the rings are metals of differing roughness, and each planet is a different archetype.
// footprint is the world-space width of the pixel at the surface, used to filter the floor pattern.
fn getMaterial(id: f32, p: vec3f, footprint: f32) -> Material {
    var m = Material(vec3f(0.5), 0.6, 0.0, vec3f(0.0));

    if (id < 1.5) { // floor: polished stone tiles with brass inlay rings
        let r = length(p.xz);
        let tile = checker(p.xz / 1.5, vec2f(max(footprint / 1.5, 0.0005)));
        let vein = veins(vec3f(p.x, 0.0, p.z) * 1.3) * smoothstep(0.08, 0.02, footprint);
        let dark = mix(vec3f(0.03, 0.045, 0.04), vec3f(0.2, 0.24, 0.22), vein);
        let light = mix(vec3f(0.62, 0.58, 0.5), vec3f(0.3, 0.27, 0.24), vein);
        m.albedo = mix(dark, light, tile);
        m.roughness = 0.07;
        let inlay = max(smoothstep(0.07 + footprint, 0.05, abs(r - 3.3)), smoothstep(0.07 + footprint, 0.05, abs(r - 7.2)));
        m.albedo = mix(m.albedo, vec3f(1.0, 0.72, 0.3), inlay);
        m.metallic = inlay;
        m.roughness = mix(m.roughness, 0.25, inlay);
    } else if (id < 2.5) { // marble: columns and ring beam
        let vein = veins(p * vec3f(1.0, 0.35, 1.0));
        m.albedo = mix(vec3f(0.74, 0.7, 0.63), vec3f(0.42, 0.4, 0.4), vein);
        m.roughness = 0.5;
    } else if (id < 3.5) { // plaster: wall and dome, with gilded ribs converging on the oculus
        let above = smoothstep(7.8, 8.1, p.y);
        let rib = smoothstep(0.16, 0.1, foldColonnade(p.xz).y) * above;
        let grain = 0.92 + 0.16 * noise3(p * 3.0);
        let wall = vec3f(0.56, 0.5, 0.42) * grain;
        let dome = mix(vec3f(0.07, 0.13, 0.26), vec3f(0.16, 0.25, 0.4), smoothstep(8.0, 17.0, p.y)) * grain;
        m.albedo = mix(mix(wall, dome, above), vec3f(0.95, 0.7, 0.32), rib);
        m.metallic = rib * 0.9;
        m.roughness = mix(0.9, 0.35, rib);
    } else if (id < 4.5) { // pedestal: dark honed stone
        m.albedo = mix(vec3f(0.05, 0.048, 0.045), vec3f(0.2, 0.18, 0.15), veins(p * 1.7));
        m.roughness = 0.35;
    } else if (id < 5.5) { // polished gold
        m.albedo = vec3f(1.0, 0.72, 0.3);
        m.roughness = 0.16;
        m.metallic = 1.0;
    } else if (id < 6.5) { // satin steel
        m.albedo = vec3f(0.6, 0.62, 0.65);
        m.roughness = 0.32;
        m.metallic = 1.0;
    } else if (id < 7.5) { // copper
        m.albedo = vec3f(0.95, 0.52, 0.36);
        m.roughness = 0.22;
        m.metallic = 1.0;
    } else if (id < 8.5) { // core
        // Slowly churning granulation, kept below the tone curve's shoulder so it reads as fire rather than white
        let cell = fbm(p * 4.0 + vec3f(0.0, frame.time * 0.15, 0.0));
        m.albedo = vec3f(0.0);
        m.emissive = mix(vec3f(1.0, 0.25, 0.04), vec3f(1.0, 0.8, 0.45), smoothstep(0.3, 0.7, cell)) * (1.5 + 7.0 * cell);
    } else {
        let planet = i32(id - M_PLANET + 0.5);
        switch planet {
            case 0 { // glazed blue ceramic
                m.albedo = vec3f(0.04, 0.18, 0.55);
                m.roughness = 0.08;
            }
            case 1 { // terracotta
                m.albedo = vec3f(0.62, 0.27, 0.16) * (0.8 + 0.4 * noise3(p * 14.0));
                m.roughness = 0.85;
            }
            case 2 { // pearl
                m.albedo = vec3f(0.85, 0.83, 0.78);
                m.roughness = 0.22;
            }
            case 3 { // chrome mirror
                m.albedo = vec3f(0.95);
                m.roughness = 0.03;
                m.metallic = 1.0;
            }
            case 4 { // red lacquer
                m.albedo = vec3f(0.6, 0.02, 0.03);
                m.roughness = 0.1;
            }
            default { // obsidian
                m.albedo = vec3f(0.015);
                m.roughness = 0.04;
            }
        }
    }

    return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shading

fn distributionGgx(NdotH: f32, alpha: f32) -> f32 {
    let alpha2 = alpha * alpha;
    let denom = NdotH * NdotH * (alpha2 - 1.0) + 1.0;
    return alpha2 / (PI * denom * denom);
}

fn visibilitySmithGgx(NdotV: f32, NdotL: f32, alpha: f32) -> f32 {
    let alpha2 = alpha * alpha;
    let ggxV = NdotL * sqrt(NdotV * NdotV * (1.0 - alpha2) + alpha2);
    let ggxL = NdotV * sqrt(NdotL * NdotL * (1.0 - alpha2) + alpha2);
    return 0.5 / (ggxV + ggxL);
}

// Lambert diffuse plus GGX specular for one light direction, premultiplied by NdotL. Light color has pi folded in.
fn brdf(n: vec3f, v: vec3f, l: vec3f, m: Material) -> vec3f {
    let h = normalize(l + v);
    let NdotL = max(dot(n, l), 0.0);
    let NdotV = max(dot(n, v), 1e-4);
    let NdotH = max(dot(n, h), 0.0);
    let VdotH = max(dot(v, h), 0.0);

    let alpha = max(m.roughness * m.roughness, 0.002);
    let f0 = mix(vec3f(0.04), m.albedo, m.metallic);
    let fresnel = f0 + (1.0 - f0) * pow(1.0 - VdotH, 5.0);
    let specular = min(distributionGgx(NdotH, alpha) * visibilitySmithGgx(NdotV, NdotL, alpha), 60.0) * fresnel;
    let diffuse = (1.0 - fresnel) * (1.0 - m.metallic) * m.albedo / PI;

    return (diffuse + specular) * PI * NdotL;
}

fn skyColor(rd: vec3f) -> vec3f {
    let sun = pow(max(dot(rd, SUN_DIR), 0.0), 600.0);
    return vec3f(0.55, 0.75, 1.0) * 2.2 + SUN_COLOR * 4.0 * sun;
}

// Sun and core light, each shadowed, plus hemispheric ambient. occlusion scales the ambient term.
fn shadeDirect(p: vec3f, n: vec3f, v: vec3f, m: Material, occlusion: f32, sunSteps: i32, coreSteps: i32) -> vec3f {
    var color = m.emissive;
    let origin = p + n * 0.004;

    // Sun, which only reaches the hall through the oculus
    if (dot(n, SUN_DIR) > 0.0) {
        let shadow = softShadow(origin, SUN_DIR, 22.0, 14.0, sunSteps);
        if (shadow > 0.0) {
            color += brdf(n, v, SUN_DIR, m) * SUN_COLOR * shadow;
        }
    }

    // Core: a warm point light. Its shadow rays stop short of the core's own surface.
    let toCore = CENTER - p;
    let coreDist = length(toCore);
    let coreDir = toCore / coreDist;
    if (dot(n, coreDir) > 0.0 && coreDist > CORE_RADIUS + 0.05) {
        let shadow = softShadow(origin, coreDir, coreDist - CORE_RADIUS - 0.05, 10.0, coreSteps);
        if (shadow > 0.0) {
            let falloff = CORE_INTENSITY / (1.0 + coreDist * coreDist);
            color += brdf(n, v, coreDir, m) * CORE_COLOR * falloff * shadow;
        }
    }

    // Ambient: cool light from above, a warm bounce from the sunlit floor below
    let diffuseAlbedo = m.albedo * (1.0 - m.metallic);
    let ambient = vec3f(0.2, 0.26, 0.36) * (0.55 + 0.45 * n.y) + vec3f(0.3, 0.22, 0.14) * (0.5 - 0.5 * n.y);
    color += diffuseAlbedo * ambient * 0.16 * occlusion;

    return color;
}

// Fresnel-weighted strength of the mirror reflection, falling off quickly with roughness
fn reflectionWeight(n: vec3f, v: vec3f, m: Material) -> vec3f {
    let f0 = mix(vec3f(0.04), m.albedo, m.metallic);
    let smoothness = 1.0 - m.roughness;
    let fresnel = f0 + (max(vec3f(smoothness), f0) - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    let gloss = smoothness * smoothness;
    return fresnel * gloss * gloss;
}

// Interleaved gradient noise: a fixed per-pixel offset that hides banding in the volumetric march
fn pixelNoise(fragCoord: vec2f) -> f32 {
    return fract(52.9829189 * fract(dot(fragCoord, vec2f(0.06711056, 0.00583715))));
}

// Light scattered toward the camera by dust in the sun shaft. The shaft is the cylinder the oculus projects along the
// sun direction; the march runs only over the part of the ray inside it, and each sample traces its own shadow ray
// so the rings and planets cut moving shadows into the beam.
fn sunShaft(ro: vec3f, rd: vec3f, tHit: f32, noise: f32) -> vec3f {
    // Ray against the infinite cylinder through the oculus center along SUN_DIR
    let oc = ro - vec3f(0.0, 17.33, 0.0);
    let rdPerp = rd - SUN_DIR * dot(rd, SUN_DIR);
    let ocPerp = oc - SUN_DIR * dot(oc, SUN_DIR);
    let a = dot(rdPerp, rdPerp);
    let b = dot(rdPerp, ocPerp);
    let c = dot(ocPerp, ocPerp) - OCULUS_RADIUS * OCULUS_RADIUS;
    let disc = b * b - a * c;
    if (disc <= 0.0 || a < 1e-6) {
        return vec3f(0.0);
    }
    let root = sqrt(disc);
    var t0 = max((-b - root) / a, 0.0);
    var t1 = min((-b + root) / a, tHit);

    // Only the part below the oculus is inside the hall
    if (abs(rd.y) > 1e-4) {
        let tTop = (17.2 - ro.y) / rd.y;
        if (rd.y > 0.0) {
            t1 = min(t1, tTop);
        } else {
            t0 = max(t0, tTop);
        }
    } else if (ro.y > 17.2) {
        return vec3f(0.0);
    }
    if (t1 <= t0) {
        return vec3f(0.0);
    }

    let dt = (t1 - t0) / f32(${orreryVolumeSamples});
    var light = 0.0;
    for (var i = 0; i < ${orreryVolumeSamples}; i++) {
        let p = ro + rd * (t0 + (f32(i) + noise) * dt);
        light += softShadow(p, SUN_DIR, 18.0, 24.0, ${orreryVolumeShadowSteps});
    }

    // Forward-biased phase so the shaft brightens when looking toward the sun
    let cosTheta = dot(rd, SUN_DIR);
    let phase = 0.35 + 0.65 * cosTheta * cosTheta;
    return SUN_COLOR * light * dt * 0.007 * phase;
}

fn render(ro: vec3f, rd: vec3f, fragCoord: vec2f) -> vec3f {
    let hit = march(ro, rd, ${orreryPrimarySteps});
    var color: vec3f;

    if (hit.y < 0.5) {
        color = skyColor(rd);
    } else {
        let t = hit.x;
        let p = ro + rd * t;
        let n = calcNormal(p, t);
        let v = -rd;
        let footprint = t * frame.pixelAngle / max(dot(n, v), 0.08);
        let m = getMaterial(hit.y, p, footprint);
        let occlusion = ambientOcclusion(p, n);

        color = shadeDirect(p, n, v, m, occlusion, ${orrerySunShadowSteps}, ${orreryCoreShadowSteps});

        // One mirror bounce, shaded with shorter shadow rays
        let weight = reflectionWeight(n, v, m);
        if (max(weight.x, max(weight.y, weight.z)) > 0.015) {
            let rr = reflect(rd, n);
            let ro2 = p + n * 0.006;
            let hit2 = march(ro2, rr, ${orreryReflectionSteps});
            var reflected: vec3f;
            if (hit2.y < 0.5) {
                reflected = skyColor(rr);
            } else {
                let p2 = ro2 + rr * hit2.x;
                let n2 = calcNormal(p2, t + hit2.x);
                let m2 = getMaterial(hit2.y, p2, (t + hit2.x) * frame.pixelAngle * 2.0);
                reflected = shadeDirect(p2, n2, -rr, m2, 1.0, ${orreryReflectionShadowSteps}, ${orreryReflectionShadowSteps});
                // A second bounce is too costly, so surfaces seen in a reflection take a constant sheen instead
                reflected += reflectionWeight(n2, -rr, m2) * vec3f(0.07, 0.065, 0.06);
            }
            // Grounded reflections fade near contact, where occlusion is strongest
            color += reflected * weight * mix(occlusion, 1.0, 0.5);
        }
    }

    // Glow around the core: brightest where the ray passes closest, cut off by whatever the ray hit first
    let toCore = CENTER - ro;
    let tClosest = clamp(dot(toCore, rd), 0.0, hit.x);
    let miss = length(toCore - rd * tClosest);
    color += CORE_COLOR * 0.3 / (1.0 + 22.0 * miss * miss);

    color += sunShaft(ro, rd, hit.x, pixelNoise(fragCoord));

    // Thin haze toward the warm tone of the hall
    color = mix(vec3f(0.035, 0.03, 0.028), color, exp(-0.01 * hit.x));

    return color;
}

struct FragmentInput
{
    @builtin(position) fragCoord: vec4f,
    @location(0) uv: vec2f
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    // uv has (0, 0) at the top left
    let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
    let rd = normalize(frame.camForward +
                       frame.camRight * (ndc.x * frame.aspect * frame.tanHalfFov) +
                       frame.camUp * (ndc.y * frame.tanHalfFov));

    return vec4f(render(frame.camPos, rd, in.fragCoord.xy), 1.0);
}
