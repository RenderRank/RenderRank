// The Orrery's fixed timeline: where the camera is and how the mechanism is posed at any time t. Everything here is
// a pure function of t, so every run shows every device the same sequence of views.

export type Vec3 = [number, number, number];

interface CameraKey {
    position: Vec3;
    target: Vec3;
}

export interface Shot {
    name: string;
    duration: number; // seconds
    fovYDegrees: number;
    keys: CameraKey[]; // evenly spaced over the shot, interpolated with a Catmull-Rom spline
}

export const orreryCenter: Vec3 = [0, 3.6, 0];

// Points on a horizontal circle, for orbiting shots
function orbit(radius: number, height: number, degrees: number): Vec3 {
    const a = degrees * Math.PI / 180;
    return [radius * Math.cos(a), height, radius * Math.sin(a)];
}

// Each shot loads the GPU differently, the way a 3DMark test moves between set pieces:
// long rays through the whole hall, floor reflections at grazing angles, dense metal shading up close, then everything
// at once from above with the sun shaft in view.
export const shots: Shot[] = [
    {
        name: 'Approach',
        duration: 10,
        fovYDegrees: 52,
        // In from the ambulatory, between two columns, toward the mechanism
        keys: [
            { position: [-11.2, 1.6, 0.5], target: [0, 3.4, 0] },
            { position: [-9.4, 1.75, 0.1], target: [0, 3.4, 0] },
            { position: [-7.4, 2.0, -0.5], target: [0, 3.3, 0] },
            { position: [-5.6, 2.3, -1.3], target: [0, 3.2, 0] },
        ],
    },
    {
        name: 'Floor skim',
        duration: 10,
        fovYDegrees: 55,
        // Low over the polished floor, circling: most of the frame is a reflection
        keys: [
            { position: orbit(7.6, 0.3, 205), target: [0, 2.4, 0] },
            { position: orbit(7.0, 0.32, 240), target: [0, 2.5, 0] },
            { position: orbit(6.4, 0.36, 275), target: [0, 2.6, 0] },
            { position: orbit(6.0, 0.45, 310), target: [0, 2.8, 0] },
        ],
    },
    {
        name: 'Mechanism',
        duration: 10,
        fovYDegrees: 38,
        // Tight orbit around the rings and core
        keys: [
            { position: orbit(4.1, 3.9, 20), target: orreryCenter },
            { position: orbit(3.9, 4.3, 60), target: orreryCenter },
            { position: orbit(3.8, 4.7, 100), target: orreryCenter },
            { position: orbit(3.9, 4.4, 140), target: orreryCenter },
        ],
    },
    {
        name: 'Ascent',
        duration: 10,
        fovYDegrees: 62,
        // Crane up under the dome, looking back down the sun shaft
        keys: [
            { position: [5.6, 1.5, 5.5], target: [0, 3.2, 0] },
            { position: [5.2, 5.0, 4.6], target: [0, 3.0, 0] },
            { position: [4.2, 9.5, 3.6], target: [0, 2.4, 0] },
            { position: [3.0, 13.4, 2.6], target: [0, 1.6, 0] },
        ],
    },
];

export const timelineDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);

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

export interface CameraPose {
    shotIndex: number;
    position: Vec3;
    target: Vec3;
    fovYDegrees: number;
}

// t in seconds; wraps around the timeline
export function cameraAt(t: number): CameraPose {
    let local = ((t % timelineDuration) + timelineDuration) % timelineDuration;
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
}

// 3x3 rotations as row arrays
type Mat3 = [Vec3, Vec3, Vec3];

function rotationX(a: number): Mat3 {
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

function rotationY(a: number): Mat3 {
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function multiply(a: Mat3, b: Mat3): Mat3 {
    return a.map(row => [0, 1, 2].map(col => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col])) as Mat3;
}

function transform(m: Mat3, v: Vec3): Vec3 {
    return m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as Vec3;
}

export interface MechanismPose {
    ringRotations: Mat3[];                          // ring-local -> world, outermost first
    planets: { center: Vec3; radius: number }[];    // 0-2 ride the rings, 3-5 orbit the hall
}

// Ring radii must match the shader's sdBand calls
const ringRadii = [2.3, 1.85, 1.4];

export function mechanismAt(t: number): MechanismPose {
    // Nested gimbals: each ring pivots on the one outside it
    const ring1 = rotationY(0.35 * t + 0.4);
    const ring2 = multiply(ring1, rotationX(0.55 * t + 1.0));
    const ring3 = multiply(ring2, rotationY(0.9 * t + 2.0));
    const ringRotations = [ring1, ring2, ring3];

    const rider = (ring: number, degrees: number, radius: number) => {
        const a = degrees * Math.PI / 180;
        const local: Vec3 = [ringRadii[ring] * Math.cos(a), ringRadii[ring] * Math.sin(a), 0];
        const world = transform(ringRotations[ring], local);
        return { center: world.map((v, axis) => v + orreryCenter[axis]) as Vec3, radius };
    };
    const orbiter = (orbitRadius: number, height: number, bob: number, speed: number, phase: number, radius: number) => {
        const a = speed * t + phase;
        const center: Vec3 = [orbitRadius * Math.cos(a), height + bob * Math.sin(0.7 * t + phase), orbitRadius * Math.sin(a)];
        return { center, radius };
    };

    return {
        ringRotations,
        planets: [
            rider(0, 45, 0.2),
            rider(1, 200, 0.16),
            rider(2, 100, 0.14),
            orbiter(5.2, 2.0, 0.3, 0.25, 0.5, 0.42),
            orbiter(6.1, 3.0, 0.4, -0.18, 2.6, 0.45),
            orbiter(7.0, 1.6, 0.3, 0.12, 4.4, 0.38),
        ],
    };
}
