// Light assignment compute shader
// One invocation per cluster. Each workgroup streams the visible lights through shared memory in batches and tests
// them against its clusters twice: first to count, so each cluster can reserve a contiguous run of the shared index
// list with a single atomic add, then to write its light indices into that run.

@group(0) @binding(2) var<storage, read_write> clusterAABBs: array<AABB>;
@group(0) @binding(3) var<storage, read_write> visibleLights: array<VisibleLight>;
@group(0) @binding(4) var<storage, read_write> lightGrid: array<LightGridEntry>;
@group(0) @binding(5) var<storage, read_write> globalLightIndexList: array<u32>;
@group(0) @binding(6) var<storage, read_write> counters: ClusteringCounters;

const totalClusters = ${clusterWidth} * ${clusterHeight} * ${clusterDepth};
const batchSize = ${clusteringWorkgroupSize}; // one light loaded per invocation
const maxLightIndices = ${maxClusterLightIndices};

var<workgroup> lightBatch: array<VisibleLight, batchSize>;
var<workgroup> sharedVisibleLightCount: u32;

fn sphereAABBIntersection(sphereCenter: vec3f, sphereRadius: f32, aabbMin: vec3f, aabbMax: vec3f) -> bool {
    let closestPoint = clamp(sphereCenter, aabbMin, aabbMax);

    let distance = length(sphereCenter - closestPoint);

    return distance <= sphereRadius;
}

@compute
@workgroup_size(${clusteringWorkgroupSize})
fn main(@builtin(global_invocation_id) globalId: vec3u, @builtin(local_invocation_index) localIdx: u32) {
    let clusterIdx = globalId.x;
    // Invocations past the last cluster still run every loop iteration, since all of a workgroup has to reach each
    // barrier
    let isCluster = clusterIdx < totalClusters;
    let lightRadius = f32(${lightRadius});

    var aabb: AABB;
    if (isCluster) {
        aabb = clusterAABBs[clusterIdx];
    }

    // The loops below contain barriers, so their trip count has to be provably uniform across the workgroup
    if (localIdx == 0u) {
        sharedVisibleLightCount = atomicLoad(&counters.visibleLightCount);
    }
    let numVisibleLights = workgroupUniformLoad(&sharedVisibleLightCount);

    // Pass 1: count this cluster's lights
    var count = 0u;
    for (var batchStart = 0u; batchStart < numVisibleLights; batchStart += batchSize) {
        if (batchStart + localIdx < numVisibleLights) {
            lightBatch[localIdx] = visibleLights[batchStart + localIdx];
        }
        workgroupBarrier();

        let batchCount = min(batchSize, numVisibleLights - batchStart);
        if (isCluster) {
            for (var i = 0u; i < batchCount; i++) {
                if (sphereAABBIntersection(lightBatch[i].viewPos, lightRadius, aabb.minPos, aabb.maxPos)) {
                    count++;
                }
            }
        }
        workgroupBarrier();
    }

    // Reserve a contiguous run. Past the list's capacity, keep whatever still fits and raise the overflow flag.
    var offset = 0u;
    if (isCluster) {
        offset = atomicAdd(&counters.lightIndexCount, count);
        if (offset + count > maxLightIndices) {
            atomicStore(&counters.overflow, 1u);
            count = select(0u, maxLightIndices - offset, offset < maxLightIndices);
        }
    }

    // Pass 2: write the indices
    var written = 0u;
    for (var batchStart = 0u; batchStart < numVisibleLights; batchStart += batchSize) {
        if (batchStart + localIdx < numVisibleLights) {
            lightBatch[localIdx] = visibleLights[batchStart + localIdx];
        }
        workgroupBarrier();

        let batchCount = min(batchSize, numVisibleLights - batchStart);
        if (isCluster) {
            for (var i = 0u; i < batchCount && written < count; i++) {
                if (sphereAABBIntersection(lightBatch[i].viewPos, lightRadius, aabb.minPos, aabb.maxPos)) {
                    globalLightIndexList[offset + written] = lightBatch[i].lightIdx;
                    written++;
                }
            }
        }
        workgroupBarrier();
    }

    if (isCluster) {
        lightGrid[clusterIdx].offset = offset;
        lightGrid[clusterIdx].count = count;
    }
}
