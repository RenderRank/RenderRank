// Tonemap fragment shader
// Maps HDR lighting into [0, 1] with an ACES filmic curve, then encodes it as sRGB for an rgba8unorm target

@group(0) @binding(0) var hdrTex: texture_2d<f32>;

// ACES filmic tone curve, fit by Krzysztof Narkowicz
fn acesFilm(x: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(c: vec3f) -> vec3f {
    let low = c * 12.92;
    let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, c <= vec3f(0.0031308));
}

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f
{
    // Same size as the HDR target, so each fragment reads exactly one texel
    let hdr = textureLoad(hdrTex, vec2u(fragCoord.xy), 0).rgb;
    return vec4f(linearToSrgb(acesFilm(hdr * ${toneMappingExposure})), 1.0);
}
