import { Mat4, mat4, Vec3, vec3 } from "wgpu-matrix";
import { toRadians } from "../math_util";
import { fovYDegrees, Resolution } from "../renderer";
import { GpuContext } from "../gpu/context";

class CameraUniforms {
    // viewProjMat (16) + invProjMat (16) + viewMat (16) + screenWidth (1) + screenHeight (1) + nearPlane (1) + farPlane (1)
    // + cameraPos (3, padded to 4 since vec3f aligns to 16 bytes) + invViewProjMat (16) = 72 floats
    readonly buffer = new ArrayBuffer(72 * 4);
    private readonly floatView = new Float32Array(this.buffer);

    set viewProjMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[i] = mat[i];
        }
    }

    set invProjMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[16 + i] = mat[i];
        }
    }

    set viewMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[32 + i] = mat[i];
        }
    }

    set screenWidth(width: number) {
        this.floatView[48] = width;
    }

    set screenHeight(height: number) {
        this.floatView[49] = height;
    }

    set nearPlane(near: number) {
        this.floatView[50] = near;
    }

    set farPlane(far: number) {
        this.floatView[51] = far;
    }

    set cameraPos(pos: Float32Array) {
        for (let i = 0; i < 3; i++) {
            this.floatView[52 + i] = pos[i];
        }
    }

    set invViewProjMat(mat: Float32Array) {
        for (let i = 0; i < 16; i++) {
            this.floatView[56 + i] = mat[i];
        }
    }
}

export class Camera {
    private gpu: GpuContext;
    private resolution: Resolution;

    uniforms: CameraUniforms = new CameraUniforms();
    uniformsBuffer: GPUBuffer;

    projMat: Mat4 = mat4.create();
    invProjMat: Mat4 = mat4.create();
    cameraPos: Vec3 = vec3.create(-7, 2, 0);
    cameraFront: Vec3 = vec3.create(0, 0, -1);
    cameraUp: Vec3 = vec3.create(0, 1, 0);
    cameraRight: Vec3 = vec3.create(1, 0, 0);
    yaw: number = 0;
    pitch: number = 0;
    moveSpeed: number = 0.004;
    sensitivity: number = 0.15;

    static readonly nearPlane = 0.1;
    static readonly farPlane = 1000;

    // Bumped whenever the projection changes, so anything derived from it (cluster bounds) knows to rebuild
    projectionVersion: number = 0;

    keys: { [key: string]: boolean } = {};

    // resolution is the render target size, not the canvas size
    constructor (gpu: GpuContext, resolution: Resolution) {
        this.gpu = gpu;
        this.resolution = resolution;

        // TODO-1.1: set `this.uniformsBuffer` to a new buffer of size `this.uniforms.buffer.byteLength`
        // ensure the usage is set to `GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST` since we will be copying to this buffer
        // check `lights.ts` for examples of using `device.createBuffer()`
        //
        // note that you can add more variables (e.g. inverse proj matrix) to this buffer in later parts of the assignment
        this.uniformsBuffer = gpu.device.createBuffer({
            label: "camera uniforms",
            size: this.uniforms.buffer.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.updateProjection();

        this.rotateCamera(0, 0); // set initial camera vectors

        window.addEventListener('keydown', (event) => this.onKeyEvent(event, true));
        window.addEventListener('keyup', (event) => this.onKeyEvent(event, false));
        window.onblur = () => this.keys = {}; // reset keys on page exit so they don't get stuck (e.g. on alt + tab)

        gpu.canvas.addEventListener('mousedown', () => gpu.canvas.requestPointerLock());
        gpu.canvas.addEventListener('mouseup', () => document.exitPointerLock());
        gpu.canvas.addEventListener('mousemove', (event) => this.onMouseMove(event));
    }

    setResolution(resolution: Resolution) {
        this.resolution = resolution;
        this.updateProjection();
    }

    private updateProjection() {
        const aspectRatio = this.resolution.width / this.resolution.height;
        this.projMat = mat4.perspective(toRadians(fovYDegrees), aspectRatio, Camera.nearPlane, Camera.farPlane);
        this.invProjMat = mat4.invert(this.projMat);
        this.projectionVersion++;
    }

    private onKeyEvent(event: KeyboardEvent, down: boolean) {
        this.keys[event.key.toLowerCase()] = down;
        if (this.keys['alt']) { // prevent issues from alt shortcuts
            event.preventDefault();
        }
    }

    private rotateCamera(dx: number, dy: number) {
        this.yaw += dx;
        this.pitch -= dy;

        if (this.pitch > 89) {
            this.pitch = 89;
        }
        if (this.pitch < -89) {
            this.pitch = -89;
        }

        const front = mat4.create();
        front[0] = Math.cos(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));
        front[1] = Math.sin(toRadians(this.pitch));
        front[2] = Math.sin(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));

        this.cameraFront = vec3.normalize(front);
        this.cameraRight = vec3.normalize(vec3.cross(this.cameraFront, [0, 1, 0]));
        this.cameraUp = vec3.normalize(vec3.cross(this.cameraRight, this.cameraFront));
    }

    private onMouseMove(event: MouseEvent) {
        if (document.pointerLockElement === this.gpu.canvas) {
            this.rotateCamera(event.movementX * this.sensitivity, event.movementY * this.sensitivity);
        }
    }

    private processInput(deltaTime: number) {
        let moveDir = vec3.create(0, 0, 0);
        if (this.keys['w']) {
            moveDir = vec3.add(moveDir, this.cameraFront);
        }
        if (this.keys['s']) {
            moveDir = vec3.sub(moveDir, this.cameraFront);
        }
        if (this.keys['a']) {
            moveDir = vec3.sub(moveDir, this.cameraRight);
        }
        if (this.keys['d']) {
            moveDir = vec3.add(moveDir, this.cameraRight);
        }
        if (this.keys['q']) {
            moveDir = vec3.sub(moveDir, this.cameraUp);
        }
        if (this.keys['e']) {
            moveDir = vec3.add(moveDir, this.cameraUp);
        }

        let moveSpeed = this.moveSpeed * deltaTime;
        const moveSpeedMultiplier = 3;
        if (this.keys['shift']) {
            moveSpeed *= moveSpeedMultiplier;
        }
        if (this.keys['alt']) {
            moveSpeed /= moveSpeedMultiplier;
        }

        if (vec3.length(moveDir) > 0) {
            const moveAmount = vec3.scale(vec3.normalize(moveDir), moveSpeed);
            this.cameraPos = vec3.add(this.cameraPos, moveAmount);
        }
    }

    onFrame(deltaTime: number) {
        this.processInput(deltaTime);

        const lookPos = vec3.add(this.cameraPos, vec3.scale(this.cameraFront, 1));
        const viewMat = mat4.lookAt(this.cameraPos, lookPos, [0, 1, 0]);
        const viewProjMat = mat4.mul(this.projMat, viewMat);
        this.uniforms.viewProjMat = viewProjMat;

        // Set clustering-related uniforms
        const invProjMat = mat4.invert(this.projMat);
        this.uniforms.invProjMat = invProjMat;
        this.uniforms.viewMat = viewMat;
        this.uniforms.screenWidth = this.resolution.width;
        this.uniforms.screenHeight = this.resolution.height;
        this.uniforms.nearPlane = Camera.nearPlane;
        this.uniforms.farPlane = Camera.farPlane;
        this.uniforms.cameraPos = this.cameraPos;
        this.uniforms.invViewProjMat = mat4.invert(viewProjMat); // for rebuilding world positions from depth

        this.gpu.device.queue.writeBuffer(this.uniformsBuffer, 0, this.uniforms.buffer);
    }
}
