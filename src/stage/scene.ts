/*
Note that this glTF loader assumes a lot of things are always defined (textures, samplers, vertex/index info, etc.),
so you may run into issues loading files outside of the Sponza scene.

In particular, it is known to not work if there is a mesh with no material.
*/

import { registerLoaders, load } from '@loaders.gl/core';
import { GLTFLoader, GLTFWithBuffers, GLTFMesh, GLTFMeshPrimitive, GLTFMaterial, GLTFSampler } from '@loaders.gl/gltf';
import { ImageLoader } from '@loaders.gl/images';
import { Mat4, mat4 } from 'wgpu-matrix';
import { GpuContext } from '../gpu/context';
import { MipmapGenerator, mipLevelCount } from '../gpu/mipmaps';

export function setupLoaders() {
    registerLoaders([GLTFLoader, ImageLoader]);
}

function getFloatArray(gltfWithBuffers: GLTFWithBuffers, attribute: number) {
    const gltf = gltfWithBuffers.json;
    const accessor = gltf.accessors![attribute];
    const bufferView = gltf.bufferViews![accessor.bufferView!];
    const buffer = gltfWithBuffers.buffers[bufferView.buffer];
    const byteOffset = (accessor.byteOffset ?? 0) + (bufferView.byteOffset ?? 0) + buffer.byteOffset;
    return new Float32Array(buffer.arrayBuffer, byteOffset, bufferView.byteLength / 4);
}

class Texture {
    image: GPUTexture;
    sampler: GPUSampler;

    constructor(image: GPUTexture, sampler: GPUSampler) {
        this.image = image;
        this.sampler = sampler;
    }
}

// 1x1 stand-ins for maps a material doesn't have: they leave the material's factors unchanged
interface DefaultTextures {
    baseColor: Texture;         // white
    normal: Texture;            // flat, pointing straight out of the surface
    metallicRoughness: Texture; // white
}

export class Material {
    private static nextId = 0;
    readonly id: number;

    materialUniformsBuffer: GPUBuffer;
    materialBindGroup: GPUBindGroup;

    constructor(gpu: GpuContext, gltfMaterial: GLTFMaterial, textures: Texture[], defaults: DefaultTextures) {
        this.id = Material.nextId++;

        const pbr = gltfMaterial.pbrMetallicRoughness;
        const baseColorTexture = pbr?.baseColorTexture ? textures[pbr.baseColorTexture.index] : defaults.baseColor;
        const normalTexture = gltfMaterial.normalTexture ? textures[gltfMaterial.normalTexture.index] : defaults.normal;
        const metallicRoughnessTexture = pbr?.metallicRoughnessTexture
            ? textures[pbr.metallicRoughnessTexture.index] : defaults.metallicRoughness;

        // glTF: OPAQUE ignores alpha, MASK cuts out below alphaCutoff. BLEND can't blend into a G-buffer, so it's cut
        // out like MASK.
        const alphaMode = gltfMaterial.alphaMode ?? 'OPAQUE';
        const alphaCutoff = alphaMode === 'OPAQUE' ? 0 : (gltfMaterial.alphaCutoff ?? 0.5);

        // Layout matches MaterialUniforms in clustered_deferred.fs.wgsl
        const uniforms = new Float32Array([
            ...(pbr?.baseColorFactor ?? [1, 1, 1, 1]),
            pbr?.metallicFactor ?? 1,
            pbr?.roughnessFactor ?? 1,
            gltfMaterial.normalTexture?.scale ?? 1,
            alphaCutoff
        ]);
        this.materialUniformsBuffer = gpu.device.createBuffer({
            label: "material uniforms",
            size: uniforms.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        gpu.device.queue.writeBuffer(this.materialUniformsBuffer, 0, uniforms);

        this.materialBindGroup = gpu.device.createBindGroup({
            label: "material bind group",
            layout: gpu.materialBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: baseColorTexture.image.createView()
                },
                {
                    binding: 1,
                    resource: baseColorTexture.sampler
                },
                {
                    binding: 2,
                    resource: normalTexture.image.createView()
                },
                {
                    binding: 3,
                    resource: normalTexture.sampler
                },
                {
                    binding: 4,
                    resource: metallicRoughnessTexture.image.createView()
                },
                {
                    binding: 5,
                    resource: metallicRoughnessTexture.sampler
                },
                {
                    binding: 6,
                    resource: { buffer: this.materialUniformsBuffer }
                }
            ]
        });
    }
}

export class Primitive {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    numIndices = -1;

    material: Material;

    constructor(device: GPUDevice, gltfPrim: GLTFMeshPrimitive, gltfWithBuffers: GLTFWithBuffers, material: Material) {
        this.material = material;

        const gltf = gltfWithBuffers.json;

        const indicesAccessor = gltf.accessors![gltfPrim.indices!];
        const indicesBufferView = gltf.bufferViews![indicesAccessor.bufferView!];
        const indicesDataType = indicesAccessor.componentType;
        const indicesBuffer = gltfWithBuffers.buffers[indicesBufferView.buffer];
        const indicesByteOffset = (indicesAccessor.byteOffset ?? 0)
            + (indicesBufferView.byteOffset ?? 0)
            + indicesBuffer.byteOffset;
        let indicesArray: Uint32Array;
        // hardcoding webgl constants, very silly
        switch (indicesDataType) {
            case 0x1403: // UNSIGNED_SHORT
                indicesArray = Uint32Array.from(
                    new Uint16Array(indicesBuffer.arrayBuffer, indicesByteOffset, indicesAccessor.count));
                break;
            case 0x1405: // UNSIGNED_INT (untested)
                indicesArray = new Uint32Array(indicesBuffer.arrayBuffer, indicesByteOffset, indicesAccessor.count);
                break;
            default:
                throw new Error(`unsupported index buffer element component type: 0x${indicesDataType.toString(16)}`);
        }

        const positionsArray = getFloatArray(gltfWithBuffers, gltfPrim.attributes.POSITION);
        const normalsArray = getFloatArray(gltfWithBuffers, gltfPrim.attributes.NORMAL);
        const uvsArray = getFloatArray(gltfWithBuffers, gltfPrim.attributes.TEXCOORD_0);
        // Left as zeros when missing; the G-buffer shader then skips normal mapping
        const tangentsArray = gltfPrim.attributes.TANGENT != undefined
            ? getFloatArray(gltfWithBuffers, gltfPrim.attributes.TANGENT) : undefined;

        const numFloatsPerVert = 12;
        const numVerts = positionsArray.length / 3;
        const vertsArray = new Float32Array(numVerts * numFloatsPerVert);
        for (let vertIdx = 0; vertIdx < numVerts; ++vertIdx) {
            const vertStartIdx = vertIdx * numFloatsPerVert;
            vertsArray[vertStartIdx] = positionsArray[vertIdx * 3];
            vertsArray[vertStartIdx + 1] = positionsArray[vertIdx * 3 + 1];
            vertsArray[vertStartIdx + 2] = positionsArray[vertIdx * 3 + 2];
            vertsArray[vertStartIdx + 3] = normalsArray[vertIdx * 3];
            vertsArray[vertStartIdx + 4] = normalsArray[vertIdx * 3 + 1];
            vertsArray[vertStartIdx + 5] = normalsArray[vertIdx * 3 + 2];
            vertsArray[vertStartIdx + 6] = uvsArray[vertIdx * 2];
            vertsArray[vertStartIdx + 7] = uvsArray[vertIdx * 2 + 1];
            if (tangentsArray != undefined) {
                vertsArray[vertStartIdx + 8] = tangentsArray[vertIdx * 4];
                vertsArray[vertStartIdx + 9] = tangentsArray[vertIdx * 4 + 1];
                vertsArray[vertStartIdx + 10] = tangentsArray[vertIdx * 4 + 2];
                vertsArray[vertStartIdx + 11] = tangentsArray[vertIdx * 4 + 3];
            }
        }

        this.indexBuffer = device.createBuffer({
            label: "index buffer",
            size: indicesArray.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.indexBuffer, 0, indicesArray);

        this.vertexBuffer = device.createBuffer({
            label: "vertex buffer",
            size: vertsArray.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.vertexBuffer, 0, vertsArray);

        this.numIndices = indicesArray.length;
    }
}

export class Mesh {
    primitives: Primitive[] = [];

    constructor(device: GPUDevice, gltfMesh: GLTFMesh, gltfWithBuffers: GLTFWithBuffers, sceneMaterials: Material[]) {
        gltfMesh.primitives.forEach((gltfPrim: GLTFMeshPrimitive) => {
            this.primitives.push(new Primitive(device, gltfPrim, gltfWithBuffers, sceneMaterials[gltfPrim.material!]));
        });

        this.primitives.sort((primA: Primitive, primB: Primitive) => {
            return primA.material.id - primB.material.id;
        });
    }
}

export class Node {
    name: String = "node";

    parent: Node | undefined;
    children: Set<Node> = new Set<Node>();

    transform: Mat4 = mat4.identity();
    modelMatUniformBuffer!: GPUBuffer;
    modelBindGroup!: GPUBindGroup;
    mesh: Mesh | undefined;

    setName(newName: string) {
        this.name = newName;
    }

    setParent(newParent: Node) {
        if (this.parent != undefined) {
            this.parent.children.delete(this);
        }

        this.parent = newParent;
        newParent.children.add(this);
    }

    propagateTransformations(gpu: GpuContext) {
        if (this.parent != undefined) {
            this.transform = mat4.mul(this.parent.transform, this.transform);
        }

        if (this.mesh != undefined) {
            this.modelMatUniformBuffer = gpu.device.createBuffer({
                label: "model mat uniform",
                size: 16 * 4,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            gpu.device.queue.writeBuffer(this.modelMatUniformBuffer, 0, this.transform);

            this.modelBindGroup = gpu.device.createBindGroup({
                label: "model bind group",
                layout: gpu.modelBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.modelMatUniformBuffer }
                    }
                ]
            });
        }

        for (let child of this.children) {
            child.propagateTransformations(gpu);
        }
    }
}

function createSolidTexture(device: GPUDevice, rgba: number[], format: GPUTextureFormat): GPUTexture {
    let texture = device.createTexture({
        size: [1, 1],
        format: format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    device.queue.writeTexture({ texture: texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);

    return texture;
}

function createTexture(device: GPUDevice, mipmaps: MipmapGenerator, imageBitmap: ImageBitmap,
    format: GPUTextureFormat): GPUTexture {
    let texture = device.createTexture({
        size: [imageBitmap.width, imageBitmap.height],
        format: format,
        mipLevelCount: mipLevelCount(imageBitmap.width, imageBitmap.height),
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: imageBitmap },
        { texture: texture },
        { width: imageBitmap.width, height: imageBitmap.height }
    );

    mipmaps.generate(texture);

    return texture;
}

function convertWrapModeEnum(wrapMode: number): GPUAddressMode {
    switch (wrapMode) {
        case 0x2901: // REPEAT
            return 'repeat';
        case 0x812F: // CLAMP_TO_EDGE
            return 'clamp-to-edge';
        case 0x8370: // MIRRORED_REPEAT
            return 'mirror-repeat';
        default:
            throw new Error(`unsupported wrap mode: 0x${wrapMode.toString(16)}`);
    }
}

function createSampler(device: GPUDevice, gltfSampler: GLTFSampler): GPUSampler {
    let samplerDescriptor: GPUSamplerDescriptor = {};

    switch (gltfSampler.magFilter) {
        case 0x2600: // NEAREST
            samplerDescriptor.magFilter = 'nearest';
            break;
        case 0x2601: // LINEAR
            samplerDescriptor.magFilter = 'linear';
            break;
        default:
            throw new Error(`unsupported magFilter: 0x${gltfSampler.magFilter!.toString(16)}`);
    }

    switch (gltfSampler.minFilter) {
        case 0x2600: // NEAREST
            samplerDescriptor.minFilter = 'nearest';
            break;
        case 0x2601: // LINEAR
            samplerDescriptor.minFilter = 'linear';
            break;
        case 0x2700: // NEAREST_MIPMAP_NEAREST
            samplerDescriptor.minFilter = 'nearest';
            samplerDescriptor.mipmapFilter = 'nearest';
            break;
        case 0x2701: // LINEAR_MIPMAP_NEAREST
            samplerDescriptor.minFilter = 'linear';
            samplerDescriptor.mipmapFilter = 'nearest';
            break;
        case 0x2702: // NEAREST_MIPMAP_LINEAR
            samplerDescriptor.minFilter = 'nearest';
            samplerDescriptor.mipmapFilter = 'linear';
            break;
        case 0x2703: // LINEAR_MIPMAP_LINEAR
            samplerDescriptor.minFilter = 'linear';
            samplerDescriptor.mipmapFilter = 'linear';
            break;
        default:
            throw new Error(`unsupported minFilter: 0x${gltfSampler.minFilter!.toString(16)}`);
    }

    samplerDescriptor.addressModeU = convertWrapModeEnum(gltfSampler.wrapS!);
    samplerDescriptor.addressModeV = convertWrapModeEnum(gltfSampler.wrapT!);

    return device.createSampler(samplerDescriptor);
}

export class Scene {
    private gpu: GpuContext;
    private root: Node = new Node();

    constructor(gpu: GpuContext) {
        this.gpu = gpu;
        this.root.setName("root");
    }

    async loadGltf(filePath: string) {
        const gltfWithBuffers = await load(filePath) as GLTFWithBuffers;
        const gltf = gltfWithBuffers.json;

        let sceneTextures: Texture[] = [];
        {
            // Base color images hold sRGB-encoded color, so sampling them has to decode to linear. Every other map
            // (normals, metallic-roughness) holds linear data and is stored as-is.
            let srgbImageIndices = new Set<number>();
            for (let gltfMaterial of gltf.materials!) {
                const baseColorTexture = gltfMaterial.pbrMetallicRoughness?.baseColorTexture;
                if (baseColorTexture != undefined) {
                    srgbImageIndices.add(gltf.textures![baseColorTexture.index].source!);
                }
            }

            const mipmaps = new MipmapGenerator(this.gpu.device);
            let sceneImages: GPUTexture[] = [];
            for (let imageIdx = 0; imageIdx < gltfWithBuffers.images!.length; ++imageIdx) {
                const format = srgbImageIndices.has(imageIdx) ? 'rgba8unorm-srgb' : 'rgba8unorm';
                sceneImages.push(createTexture(this.gpu.device, mipmaps, gltfWithBuffers.images![imageIdx] as ImageBitmap, format));
            }

            let sceneSamplers: GPUSampler[] = [];
            for (let gltfSampler of gltf.samplers!) {
                sceneSamplers.push(createSampler(this.gpu.device, gltfSampler));
            }

            for (let gltfTexture of gltf.textures!) {
                sceneTextures.push(new Texture(sceneImages[gltfTexture.source!], sceneSamplers[gltfTexture.sampler!]));
            }
        }

        const device = this.gpu.device;
        const defaultSampler = device.createSampler();
        const defaultTextures: DefaultTextures = {
            baseColor: new Texture(createSolidTexture(device, [255, 255, 255, 255], 'rgba8unorm-srgb'), defaultSampler),
            normal: new Texture(createSolidTexture(device, [128, 128, 255, 255], 'rgba8unorm'), defaultSampler),
            metallicRoughness: new Texture(createSolidTexture(device, [255, 255, 255, 255], 'rgba8unorm'), defaultSampler)
        };

        let sceneMaterials: Material[] = [];
        for (let gltfMaterial of gltf.materials!) {
            sceneMaterials.push(new Material(this.gpu, gltfMaterial, sceneTextures, defaultTextures));
        }

        let sceneMeshes: Mesh[] = [];
        for (let gltfMesh of gltf.meshes!) {
            sceneMeshes.push(new Mesh(this.gpu.device, gltfMesh, gltfWithBuffers, sceneMaterials));
        }

        let sceneRoot: Node = new Node();
        sceneRoot.setName("scene root");
        sceneRoot.setParent(this.root);

        let sceneNodes: Node[] = [];
        for (let gltfNode of gltf.nodes!) {
            let newNode = new Node();
            newNode.setName(gltfNode.name);
            newNode.setParent(sceneRoot);

            if (gltfNode.mesh != undefined) {
                newNode.mesh = sceneMeshes[gltfNode.mesh];
            }

            if (gltfNode.matrix != undefined) {
                newNode.transform = new Float32Array(gltfNode.matrix);
            } else {
                if (gltfNode.translation != undefined) {
                    newNode.transform = mat4.mul(newNode.transform, mat4.translation(gltfNode.translation));
                }

                if (gltfNode.rotation != undefined) {
                    newNode.transform = mat4.mul(newNode.transform, mat4.fromQuat(gltfNode.rotation));
                }

                if (gltfNode.scale != undefined) {
                    newNode.transform = mat4.mul(newNode.transform, mat4.scaling(gltfNode.scale));
                }
            }

            sceneNodes.push(newNode);
        }

        for (let nodeIdx in gltf.nodes!) {
            const gltfNode = gltf.nodes[nodeIdx];

            if (gltfNode.children == undefined) {
                continue;
            }

            for (let childNodeIdx of gltfNode.children) {
                sceneNodes[childNodeIdx].setParent(sceneNodes[nodeIdx]);
            }
        }

        sceneRoot.propagateTransformations(this.gpu);
    }

    iterate(nodeFunction: (node: Node) => void, materialFunction: (material: Material) => void,
        primFunction: (primitive: Primitive) => void) {
        let nodes = [this.root];

        let lastMaterialId: number | undefined = undefined;

        while (nodes.length > 0) {
            let node = nodes.pop() as Node;
            if (node.mesh != undefined) {
                nodeFunction(node);

                for (let primitive of node.mesh.primitives) {
                    if (primitive.material.id != lastMaterialId) {
                        materialFunction(primitive.material);
                        lastMaterialId = primitive.material.id;
                    }

                    primFunction(primitive);
                }
            }

            for (let childNode of node.children) {
                nodes.push(childNode);
            }
        }
    }
}
