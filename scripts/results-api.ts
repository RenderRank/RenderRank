// Dev/preview-server endpoint that saves uploaded benchmark results as JSON files under results/ (gitignored).
// The server is reachable from the internet, so everything about a request is treated as hostile: size is capped,
// the file name is generated here, uploads are rate limited, and the directory has a file limit.
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

const maxBodyBytes = 512 * 1024;
const maxStoredResults = 5000;
const maxUploadsPerWindow = 20;
const windowMs = 10 * 60 * 1000;
const allowedOriginHosts = ['renderrank.tonyxtian.com', 'localhost', '127.0.0.1'];

// Client address -> upload times within the window. Kept in memory only; addresses are never written to disk.
const recentUploads = new Map<string, number[]>();

function send(res: ServerResponse, status: number, body: object) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBodyBytes) {
                resolve(undefined);
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function createHandler(directory: string) {
    return async (req: IncomingMessage, res: ServerResponse) => {
        try {
            if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
            if (!String(req.headers['content-type']).includes('application/json')) return send(res, 415, { error: 'Send JSON.' });

            // Browsers attach Origin to cross-site POSTs; only this site's own pages may upload
            const origin = req.headers.origin;
            if (origin) {
                let host = '';
                try { host = new URL(origin).hostname; } catch { /* malformed */ }
                if (!allowedOriginHosts.includes(host)) return send(res, 403, { error: 'Uploads are only accepted from this site.' });
            }

            const client = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
            const now = Date.now();
            const times = (recentUploads.get(client) ?? []).filter(time => now - time < windowMs);
            if (times.length >= maxUploadsPerWindow) return send(res, 429, { error: 'Too many uploads. Try again later.' });
            times.push(now);
            recentUploads.set(client, times);

            const body = await readBody(req);
            if (!body) return send(res, 413, { error: 'Result is too large.' });

            let result: any;
            try { result = JSON.parse(body.toString('utf8')); } catch { return send(res, 400, { error: 'Invalid JSON.' }); }
            const sceneId = result?.scene?.id;
            if (typeof sceneId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(sceneId) || !Array.isArray(result.rows)) {
                return send(res, 400, { error: 'Not a RenderRank result.' });
            }

            await mkdir(directory, { recursive: true });
            if ((await readdir(directory)).length >= maxStoredResults) return send(res, 507, { error: 'Result storage is full.' });

            const receivedAt = new Date(now).toISOString();
            const id = `${receivedAt.replace(/[:.]/g, '-')}-${sceneId}-${randomBytes(4).toString('hex')}`;
            // 'wx' fails rather than overwriting if the name somehow exists
            await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ id, receivedAt, result }, null, 2), { flag: 'wx' });
            send(res, 201, { id });
        } catch (error) {
            console.error('results upload failed', error);
            send(res, 500, { error: 'Could not save the result.' });
        }
    };
}

export function resultsApi(): Plugin {
    const directory = path.resolve(process.cwd(), 'results');
    return {
        name: 'renderrank-results-api',
        configureServer(server) { server.middlewares.use('/api/results', createHandler(directory)); },
        configurePreviewServer(server) { server.middlewares.use('/api/results', createHandler(directory)); },
    };
}
