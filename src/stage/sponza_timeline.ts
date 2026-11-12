// Sponza's benchmark timeline: four camera shots through the atrium. Together with the light paths (a pure function
// of time, in move_lights.cs.wgsl) and fixed light colors, every run renders the same frames on every device.
//
// World units (measured from slices of the mesh): the long axis is x, y is up, and the ground floor is at y = 0.
// Columns and curtains line the courtyard at z = -2.2 and 1.2 from x = -8.5 to 7.5, so the open courtyard is
// z -2..1, with ground-floor aisles at z -5.3..-2.7 and 1.7..4.3 and open halls at both ends. The galleries above the
// aisles have their floor at y = 3.3 and ceiling at 6.9. Above y = 8 the courtyard is walled in at x -9..7.5, z -2.5..1, open to the sky;
// the highest geometry is at y = 11.4. The lights move inside x -10..10, y 0..8, z -5..5.
import { createTimeline } from '../timeline';
import type { Shot } from '../timeline';

// Each shot puts a different part of the work in front of the camera: the whole lit courtyard, dense geometry close
// by in an aisle, the courtyard seen from the gallery above it, then a rising view down the whole length.
const shots: Shot[] = [
    {
        name: 'Courtyard',
        duration: 10,
        fovYDegrees: 55,
        // Walk down the middle of the courtyard at eye height, from the west hall
        keys: [
            { position: [-10.0, 1.6, -0.5], target: [4.0, 2.4, -0.9] },
            { position: [-6.8, 1.65, -0.6], target: [6.0, 2.7, -0.6] },
            { position: [-3.6, 1.7, -0.6], target: [8.0, 3.0, -0.2] },
            { position: [-0.4, 1.75, -0.5], target: [10.0, 3.4, 0.2] },
        ],
    },
    {
        name: 'Arcade',
        duration: 10,
        fovYDegrees: 60,
        // West along the south aisle, columns and curtains passing on the right
        keys: [
            { position: [6.5, 1.5, -4.4], target: [-3.0, 1.8, -2.9] },
            { position: [3.0, 1.5, -4.4], target: [-6.5, 1.9, -3.0] },
            { position: [-0.5, 1.5, -4.4], target: [-10.0, 2.0, -3.2] },
            { position: [-4.0, 1.5, -4.4], target: [-13.0, 2.1, -3.6] },
        ],
    },
    {
        name: 'Gallery',
        duration: 10,
        fovYDegrees: 55,
        // East along the north gallery beside the balustrade, looking over it into the courtyard
        keys: [
            { position: [-7.0, 5.8, 2.8], target: [-1.0, 1.0, -1.5] },
            { position: [-3.0, 5.8, 2.8], target: [3.0, 1.0, -1.5] },
            { position: [1.0, 5.8, 2.8], target: [7.0, 1.0, -1.5] },
            { position: [4.2, 5.8, 2.8], target: [9.0, 0.6, -1.6] },
        ],
    },
    {
        name: 'Ascent',
        duration: 10,
        fovYDegrees: 60,
        // Rise from the courtyard floor's east end to just under the roofline, looking back down its length
        keys: [
            { position: [5.6, 1.0, -0.5], target: [-8.0, 2.0, -0.5] },
            { position: [5.5, 4.0, -0.5], target: [-8.0, 1.6, -0.5] },
            { position: [5.4, 7.2, -0.5], target: [-7.5, 1.0, -0.5] },
            { position: [5.2, 10.2, -0.5], target: [-7.0, 0.0, -0.5] },
        ],
    },
];

export const sponzaTimeline = createTimeline(shots);
