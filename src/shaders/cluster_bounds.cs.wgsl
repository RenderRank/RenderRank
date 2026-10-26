// Cluster bounds compute shader
// Computes each cluster's view-space AABB. Bounds depend only on the projection and the render resolution, so this
// runs once instead of every frame.

@group(0) @binding(0) var<uniform> cameraUniforms: CameraUniforms;
@group(0) @binding(2) var<storage, read_write> clusterAABBs: array<AABB>;

const totalClusters = ${clusterWidth} * ${clusterHeight} * ${clusterDepth};

@compute
@workgroup_size(${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) globalId: vec3u) {
    let clusterIdx = globalId.x;
    if (clusterIdx >= totalClusters) {
        return;
    }

    let clusterX = clusterIdx % ${clusterWidth};
    let clusterY = (clusterIdx / ${clusterWidth}) % ${clusterHeight};
    let clusterZ = clusterIdx / (${clusterWidth} * ${clusterHeight});

    let screenWidth = cameraUniforms.screenWidth;
    let screenHeight = cameraUniforms.screenHeight;

    // Calculate screen-space tile bounds (in pixels)
    let tileSize = vec2f(
        screenWidth / f32(${clusterWidth}),
        screenHeight / f32(${clusterHeight})
    );

    let minScreen = vec2f(f32(clusterX), f32(clusterY)) * tileSize;
    let maxScreen = minScreen + tileSize;

    // Get depth bounds for this slice using exponential distribution
    let depthBounds = getDepthSliceBounds(clusterZ, cameraUniforms.nearPlane, cameraUniforms.farPlane);
    let nearDepth = depthBounds.x;
    let farDepth = depthBounds.y;

    // Convert screen corners to NDC [-1, 1]
    let minScreenNDC_y = 1.0 - (maxScreen.y / screenHeight) * 2.0;
    let maxScreenNDC_y = 1.0 - (minScreen.y / screenHeight) * 2.0;

    let minScreenNDC = vec2f(
        (minScreen.x / screenWidth) * 2.0 - 1.0,
        minScreenNDC_y
    );
    let maxScreenNDC = vec2f(
        (maxScreen.x / screenWidth) * 2.0 - 1.0,
        maxScreenNDC_y
    );

    // Build the 4 corner points at near and far planes (8 points total) in view-space
    let invProj = cameraUniforms.invProjMat;

    var minView = vec3f(1e10, 1e10, 1e10);
    var maxView = vec3f(-1e10, -1e10, -1e10);

    // Test 8 corners of the frustum cluster
    for (var i = 0u; i < 2u; i++) {
        for (var j = 0u; j < 2u; j++) {
            for (var k = 0u; k < 2u; k++) {
                let x = select(minScreenNDC.x, maxScreenNDC.x, i == 1u);
                let y = select(minScreenNDC.y, maxScreenNDC.y, j == 1u);
                let depth = select(nearDepth, farDepth, k == 1u);

                // Unproject screen point at this depth
                let ndc = vec4f(x, y, 0.0, 1.0);
                var viewPos = invProj * ndc;
                viewPos = viewPos / viewPos.w;

                // Scale by depth
                let scale = depth / -viewPos.z;
                viewPos = viewPos * scale;

                minView = min(minView, viewPos.xyz);
                maxView = max(maxView, viewPos.xyz);
            }
        }
    }

    clusterAABBs[clusterIdx].minPos = minView;
    clusterAABBs[clusterIdx].maxPos = maxView;
}
