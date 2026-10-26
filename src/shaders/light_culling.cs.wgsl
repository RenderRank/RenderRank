// Light culling compute shader
// Drops lights whose sphere of influence lies entirely outside the view frustum, and compacts the rest, already in
// view space, into visibleLights for the assignment pass.

@group(0) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(3) var<storage, read_write> visibleLights: array<VisibleLight>;
@group(0) @binding(6) var<storage, read_write> counters: ClusteringCounters;

// Signed distance from a world-space point to a frustum plane, positive on the inside
fn planeDistance(plane: vec4f, p: vec3f) -> f32 {
    return (dot(plane.xyz, p) + plane.w) / length(plane.xyz);
}

@compute
@workgroup_size(${lightCullingWorkgroupSize})
fn main(@builtin(global_invocation_id) globalId: vec3u) {
    let lightIdx = globalId.x;
    if (lightIdx >= lightSet.numLights) {
        return;
    }

    let lightPos = lightSet.lights[lightIdx].pos;
    let radius = f32(${lightRadius});

    // World-space frustum planes from the rows of the view-projection matrix (Gribb-Hartmann). WGSL matrices are
    // column-major, so row r is m[0][r], m[1][r], m[2][r], m[3][r]. WebGPU clip space keeps 0 <= z <= w, which makes
    // row 2 alone the near plane.
    let m = cameraUniforms.viewProjMat;
    let row0 = vec4f(m[0][0], m[1][0], m[2][0], m[3][0]);
    let row1 = vec4f(m[0][1], m[1][1], m[2][1], m[3][1]);
    let row2 = vec4f(m[0][2], m[1][2], m[2][2], m[3][2]);
    let row3 = vec4f(m[0][3], m[1][3], m[2][3], m[3][3]);

    if (planeDistance(row3 + row0, lightPos) < -radius || // left
        planeDistance(row3 - row0, lightPos) < -radius || // right
        planeDistance(row3 + row1, lightPos) < -radius || // bottom
        planeDistance(row3 - row1, lightPos) < -radius || // top
        planeDistance(row2, lightPos) < -radius ||        // near
        planeDistance(row3 - row2, lightPos) < -radius) { // far
        return;
    }

    // At most numLights survive, so the slot always fits
    let slot = atomicAdd(&counters.visibleLightCount, 1u);
    visibleLights[slot] = VisibleLight((cameraUniforms.viewMat * vec4f(lightPos, 1.0)).xyz, lightIdx);
}
