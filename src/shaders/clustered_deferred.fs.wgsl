// Clustered Deferred G-buffer fragment shader
// This shader stores material information (base color, metallic, normal-mapped normal, roughness) into two packed
// G-buffers. Position comes from the depth buffer instead. No lighting calculations are performed here.

// Matches the material uniform buffer written in scene.ts
struct MaterialUniforms {
    baseColorFactor: vec4f,
    metallicFactor: f32,
    roughnessFactor: f32,
    normalScale: f32,
    alphaCutoff: f32 // 0 for opaque materials, so nothing is discarded
}

@group(${bindGroup_material}) @binding(0) var baseColorTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var baseColorSampler: sampler;
@group(${bindGroup_material}) @binding(2) var normalTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(3) var normalSampler: sampler;
@group(${bindGroup_material}) @binding(4) var metallicRoughnessTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(5) var metallicRoughnessSampler: sampler;
@group(${bindGroup_material}) @binding(6) var<uniform> material: MaterialUniforms;

struct FragmentInput
{
    @builtin(front_facing) frontFacing: bool,
    @location(0) nor: vec3f,
    @location(1) uv: vec2f,
    @location(2) tangent: vec4f
}

struct GBufferOutput
{
    @location(0) albedoMetallic: vec4f,  // rgba8unorm-srgb: rgb base color, a metallic (alpha is stored linear)
    @location(1) normalRoughness: vec4f  // rgb10a2unorm: rg octahedral normal, b roughness, a unused
}

@fragment
fn main(in: FragmentInput) -> GBufferOutput
{
    // All sampling happens up front: implicit-derivative sampling has to stay in uniform control flow
    let baseColor = textureSample(baseColorTex, baseColorSampler, in.uv) * material.baseColorFactor;
    let normalSample = textureSample(normalTex, normalSampler, in.uv).xyz;
    let metallicRoughness = textureSample(metallicRoughnessTex, metallicRoughnessSampler, in.uv);

    if (baseColor.a < material.alphaCutoff) {
        discard;
    }

    // Tangent-space normal map, applied through a Gram-Schmidt orthogonalized TBN frame. Meshes without tangents
    // interpolate to a zero tangent and keep the vertex normal.
    let vertexNormal = normalize(in.nor);
    let orthoTangent = in.tangent.xyz - vertexNormal * dot(vertexNormal, in.tangent.xyz);
    var normal = vertexNormal;
    if (dot(orthoTangent, orthoTangent) > 1e-12) {
        let tangent = normalize(orthoTangent);
        let bitangent = cross(vertexNormal, tangent) * in.tangent.w;
        let mapped = (normalSample * 2.0 - 1.0) * vec3f(material.normalScale, material.normalScale, 1.0);
        normal = normalize(tangent * mapped.x + bitangent * mapped.y + vertexNormal * mapped.z);
    }

    // Back faces of double-sided surfaces (foliage, cloth) shade with the whole frame flipped
    normal *= select(-1.0, 1.0, in.frontFacing);

    // glTF packs roughness in G and metallic in B
    let roughness = metallicRoughness.g * material.roughnessFactor;
    let metallic = metallicRoughness.b * material.metallicFactor;

    var output: GBufferOutput;

    output.albedoMetallic = vec4f(baseColor.rgb, metallic);

    output.normalRoughness = vec4f(encodeOctahedral(normal), roughness, 0.0);

    return output;
}
