// Clustered Deferred fullscreen fragment shader
// Reads from G-buffers and performs clustered lighting calculations

// Bind group 0: Scene data and G-buffer textures
@group(0) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read> lightGrid: array<LightGridEntry>;
@group(0) @binding(3) var<storage, read> globalLightIndexList: array<u32>;
@group(0) @binding(4) var depthTex: texture_depth_2d;
@group(0) @binding(5) var gBufferAlbedoMetallicTex: texture_2d<f32>;
@group(0) @binding(6) var gBufferNormalRoughnessTex: texture_2d<f32>;

struct FragmentInput
{
    @builtin(position) fragCoord: vec4f
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    // The G-buffers match this pass's target size, so each fragment loads exactly its own texel
    let texel = vec2u(in.fragCoord.xy);
    let depth = textureLoad(depthTex, texel, 0);

    // Nothing was drawn where depth still holds its clear value
    if (depth >= 1.0) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let albedoMetallic = textureLoad(gBufferAlbedoMetallicTex, texel, 0);
    let normalRoughness = textureLoad(gBufferNormalRoughnessTex, texel, 0);

    // Unpack G-buffers
    let screenSize = vec2f(cameraUniforms.screenWidth, cameraUniforms.screenHeight);
    let worldPos = reconstructWorldPos(in.fragCoord.xy, depth, screenSize, cameraUniforms.invViewProjMat);
    let normal = decodeOctahedral(normalRoughness.xy);
    let albedo = albedoMetallic.rgb;
    let metallic = albedoMetallic.a;
    // The floor keeps the GGX lobe from collapsing into an infinitely sharp, aliasing spike
    let roughness = clamp(normalRoughness.z, 0.045, 1.0);
    let viewDir = normalize(cameraUniforms.cameraPos - worldPos);

    // Transform world position to view space to get view Z
    let viewPos = cameraUniforms.viewMat * vec4f(worldPos, 1.0);
    let viewZ = viewPos.z;

    // Determine which cluster this fragment belongs to
    let clusterIdx = getClusterIndex(
        in.fragCoord,
        viewZ,
        cameraUniforms.screenWidth,
        cameraUniforms.screenHeight,
        cameraUniforms.nearPlane,
        cameraUniforms.farPlane
    );

    // Get the lights affecting this cluster
    let gridEntry = lightGrid[clusterIdx];
    let lightCount = gridEntry.count;
    let lightOffset = gridEntry.offset;

    // Accumulate light contributions
    var totalLightContrib = vec3f(0.0, 0.0, 0.0);

    for (var i = 0u; i < lightCount; i++) {
        let lightIdx = globalLightIndexList[lightOffset + i];
        let light = lightSet.lights[lightIdx];
        totalLightContrib += calculateLightContrib(light, worldPos, normal, viewDir, albedo, metallic, roughness);
    }

    return vec4f(totalLightContrib, 1.0);
}
