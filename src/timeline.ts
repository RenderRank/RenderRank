// A benchmark's fixed camera timeline: a sequence of shots, each a camera path that runs for a set time. Everything is
// a pure function of the timeline time t, so every run shows every device the same views in the same order.

export type Vec3 = [number, number, number];

export interface CameraKey {
    position: Vec3;
    target: Vec3;
}

export interface Shot {
    name: string;
    duration: number; // seconds
    fovYDegrees: number;
    keys: CameraKey[]; // evenly spaced over the shot, interpolated with a Catmull-Rom spline
}

export interface CameraPose {
    shotIndex: number;
    position: Vec3;
    target: Vec3;
    fovYDegrees: number;
}

export interface Timeline {
    shots: Shot[];
    duration: number; // seconds
    cameraAt(t: number): CameraPose;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

function sampleKeys(keys: CameraKey[], pick: (key: CameraKey) => Vec3, s: number): Vec3 {
    const x = Math.min(Math.max(s, 0), 1) * (keys.length - 1);
    const i = Math.min(Math.floor(x), keys.length - 2);
    const u = x - i;
    const at = (index: number) => pick(keys[Math.min(Math.max(index, 0), keys.length - 1)]);
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    return [0, 1, 2].map(axis => catmullRom(a[axis], b[axis], c[axis], d[axis], u)) as Vec3;
}

export function createTimeline(shots: Shot[]): Timeline {
    const duration = shots.reduce((sum, shot) => sum + shot.duration, 0);
    return {
        shots,
        duration,
        // t in seconds; wraps around the timeline
        cameraAt(t: number): CameraPose {
            let local = ((t % duration) + duration) % duration;
            let shotIndex = 0;
            while (shotIndex < shots.length - 1 && local >= shots[shotIndex].duration) {
                local -= shots[shotIndex].duration;
                shotIndex++;
            }
            const shot = shots[shotIndex];
            const s = local / shot.duration;
            return {
                shotIndex,
                position: sampleKeys(shot.keys, key => key.position, s),
                target: sampleKeys(shot.keys, key => key.target, s),
                fovYDegrees: shot.fovYDegrees,
            };
        },
    };
}
