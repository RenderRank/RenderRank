struct VertexOutput
{
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput
{
    // Generate fullscreen quad vertices using vertex index
    // Two triangles covering the screen from (-1, -1) to (1, 1) in clip space
    const positions = array<vec2f, 6>(
        vec2f(-1.0, -1.0),  
        vec2f(1.0, -1.0),   
        vec2f(-1.0, 1.0),  
        vec2f(-1.0, 1.0),   
        vec2f(1.0, -1.0),   
        vec2f(1.0, 1.0)    
    );

    // UV coordinates for sampling G-buffer textures
    // (0, 0) is top-left, (1, 1) is bottom-right
    const uvs = array<vec2f, 6>(
        vec2f(0.0, 1.0),  
        vec2f(1.0, 1.0),  
        vec2f(0.0, 0.0),  
        vec2f(0.0, 0.0),  
        vec2f(1.0, 1.0),  
        vec2f(1.0, 0.0)   
    );

    var output: VertexOutput;
    output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
    output.uv = uvs[vertexIndex];
    return output;
}
