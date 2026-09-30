import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        target: 'esnext'
    },
    base: process.env.GITHUB_ACTIONS_BASE || '/',
    server: {
        host: '127.0.0.1',
        port: 5174,
        strictPort: true,
        allowedHosts: [
            'renderrank.tonyxtian.com',
            'localhost',
            '127.0.0.1'
        ],
        fs: {
            // Vite's defaults plus .claude/, since this dev server is reachable from the internet
            deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.claude/**']
        }
    }
})
