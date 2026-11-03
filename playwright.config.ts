import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    workers: 1,
    webServer: process.env.PREVIEW_URL ? undefined : {
        command: 'npm run dev -- --port 5175 --no-open',
        url: 'http://127.0.0.1:5175',
        reuseExistingServer: !process.env.CI,
    },
    use: {
        baseURL: process.env.PREVIEW_URL || 'http://127.0.0.1:5175',
        viewport: { width: 1440, height: 1000 },
        launchOptions: { args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] },
        screenshot: 'only-on-failure',
    },
});
