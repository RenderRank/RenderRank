// Blit fragment shader
// Copies a texture into the current render target with linear filtering; used for mip downsampling and presenting

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

struct FragmentInput
{
    @location(0) uv: vec2f
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    return textureSample(srcTex, srcSampler, in.uv);
}
