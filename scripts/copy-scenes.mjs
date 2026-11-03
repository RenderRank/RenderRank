import { cpSync } from 'node:fs';

// Use explicit paths: macOS cp treats a trailing source slash differently from Linux.
cpSync(new URL('../scenes/', import.meta.url), new URL('../dist/scenes/', import.meta.url), {
    recursive: true,
});
