// Clustered Deferred G-buffer vertex shader
// Transforms scene geometry and passes world-space position, normal, tangent, and UV to the G-buffer fragment shader

// TODO-1.3: add a uniform variable here for camera uniforms (of type CameraUniforms)
// make sure to use ${bindGroup_scene} for the group
@group(${bindGroup_scene}) @binding(0) var<uniform> cameraUniforms: CameraUniforms;

@group(${bindGroup_model}) @binding(0) var<uniform> modelMat: mat4x4f;

struct VertexInput
{
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec4f // xyz direction, w bitangent sign; all zero when the mesh has no tangents
}

struct VertexOutput
{
    @builtin(position) fragPos: vec4f,
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec4f
}

@vertex
fn main(in: VertexInput) -> VertexOutput
{
    let modelPos = modelMat * vec4(in.pos, 1);

    // Directions go through the upper 3x3. That's exact for rotation and uniform scale (Sponza's case); non-uniform
    // scale would need the inverse transpose for normals.
    let modelDirMat = mat3x3f(modelMat[0].xyz, modelMat[1].xyz, modelMat[2].xyz);

    var out: VertexOutput;
    out.fragPos = cameraUniforms.viewProjMat * modelPos; // TODO-1.3: replace ??? with the view proj mat from your CameraUniforms uniform variable
    out.pos = modelPos.xyz / modelPos.w;
    out.nor = modelDirMat * in.nor;
    out.uv = in.uv;
    out.tangent = vec4f(modelDirMat * in.tangent.xyz, in.tangent.w);
    return out;
}
