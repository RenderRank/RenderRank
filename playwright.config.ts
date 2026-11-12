import { defineConfig } from '@playwright/test';
import { testClientId } from './tests/fake-google';

export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    workers: 1,
    webServer: process.env.PREVIEW_URL ? undefined : {
        command: 'npm run dev -- --port 5175 --no-open',
        url: 'http://127.0.0.1:5175',
        reuseExistingServer: !process.env.CI,
        // Sign-in tests need a server built with the fake Google client (tests/fake-google.ts). A reused server must
        // have been started with the same value.
        env: { VITE_GOOGLE_CLIENT_ID: testClientId },
    },
    use: {
        baseURL: process.env.PREVIEW_URL || 'http://127.0.0.1:5175',
        viewport: { width: 1440, height: 1000 },
        launchOptions: { args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] },
        screenshot: 'only-on-failure',
    },
});
