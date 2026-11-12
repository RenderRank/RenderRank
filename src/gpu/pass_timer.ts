import { GpuContext } from './context';

// GPU time from the start of one pass to the end of another (or of a single pass), when the device supports
// timestamp queries. The browser quantizes these, so they are a diagnostic, but unlike frame intervals they aren't
// rounded up to the display's refresh period.
//
// Usage per frame: pass `begin` to the first timed pass and `end` to the last (or `both` to a single pass), call
// resolve() after the last one, then afterSubmit() once the encoder is submitted.
export class PassTimer {
    private querySet?: GPUQuerySet;
    private resolveBuffer?: GPUBuffer;
    private readBuffer?: GPUBuffer;
    private readPending = false;
    private copied = false;
    gpuTimeMs: number | undefined;

    constructor(gpu: GpuContext) {
        if (!gpu.hasTimestampQuery) return;
        this.querySet = gpu.device.createQuerySet({ type: "timestamp", count: 2 });
        this.resolveBuffer = gpu.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
        });
        this.readBuffer = gpu.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        });
    }

    get begin(): GPURenderPassTimestampWrites | undefined {
        return this.querySet && { querySet: this.querySet, beginningOfPassWriteIndex: 0 };
    }

    get end(): GPURenderPassTimestampWrites | undefined {
        return this.querySet && { querySet: this.querySet, endOfPassWriteIndex: 1 };
    }

    get both(): GPURenderPassTimestampWrites | undefined {
        return this.querySet && { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
    }

    // One readback in flight at a time; frames in between go unmeasured rather than stalling
    resolve(encoder: GPUCommandEncoder) {
        if (!this.querySet || this.readPending) return;
        encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer!, 0);
        encoder.copyBufferToBuffer(this.resolveBuffer!, 0, this.readBuffer!, 0, 16);
        this.copied = true;
    }

    afterSubmit() {
        if (!this.copied) return;
        this.copied = false;
        this.readPending = true;
        const buffer = this.readBuffer!;
        buffer.mapAsync(GPUMapMode.READ).then(() => {
            const [begin, end] = new BigInt64Array(buffer.getMappedRange());
            if (end > begin) this.gpuTimeMs = Number(end - begin) / 1e6;
            buffer.unmap();
            this.readPending = false;
        }).catch(() => { /* the buffer was destroyed with its renderer */ });
    }

    destroy() {
        this.querySet?.destroy();
        this.resolveBuffer?.destroy();
        this.readBuffer?.destroy();
    }
}
