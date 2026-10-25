// Clustered Deferred fullscreen fragment shader
// Reads from G-buffers and performs clustered lighting calculations

// Bind group 0: Scene data and G-buffer textures
@group(0) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read> lightGrid: array<LightGridEntry>;
@group(0) @binding(3) var<storage, read> globalLightIndexList: array<u32>;
@group(0) @binding(4) var gBufferPositionTex: texture_2d<f32>;
@group(0) @binding(5) var gBufferNormalTex: texture_2d<f32>;
@group(0) @binding(6) var gBufferAlbedoTex: texture_2d<f32>;
@group(0) @binding(7) var gBufferSampler: sampler;

struct FragmentInput
{
    @builtin(position) fragCoord: vec4f,
    @location(0) uv: vec2f
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    // Sample G-buffer textures
    let positionData = textureSample(gBufferPositionTex, gBufferSampler, in.uv);
    let normalData = textureSample(gBufferNormalTex, gBufferSampler, in.uv);
    let albedoData = textureSample(gBufferAlbedoTex, gBufferSampler, in.uv);

    // Extract data from G-buffers
    let worldPos = positionData.xyz;
    let normal = normalize(normalData.xyz);
    let albedo = albedoData.rgb;
    let metallic = albedoData.a;
    // The floor keeps the GGX lobe from collapsing into an infinitely sharp, aliasing spike
    let roughness = clamp(normalData.w, 0.045, 1.0);
    let viewDir = normalize(cameraUniforms.cameraPos - worldPos);

    // Check if this is a background pixel (no geometry rendered)
    // Background will have position (0, 0, 0) and can be handled differently
    if (length(normalData.xyz) < 0.01) {
        // No geometry at this pixel, return black or background color
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }

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
