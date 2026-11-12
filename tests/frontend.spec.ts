import { expect, test } from '@playwright/test';

const sceneNav = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation', { name: 'Scenes' }).getByRole('link', { name, exact: true });

test('root opens the library without fetching or starting a scene', async ({ page }, testInfo) => {
    const scenes: string[] = [];
    page.on('request', request => { if (request.url().includes('/scenes/')) scenes.push(request.url()); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Simulations', exact: true })).toBeVisible();
    await expect(page.locator('.scene-card')).toHaveCount(2);
    await expect(sceneNav(page, 'Sponza')).toBeVisible();
    await expect(sceneNav(page, 'Results')).toBeHidden();
    await expect(page.locator('#view-scene')).toBeHidden();
    await expect(page.locator('#view-results')).toBeHidden();
    await expect(page.locator('.sidebar')).not.toContainText('WORKSPACE');
    await expect(page.locator('#device-system')).not.toHaveText('—');
    await expect(page.locator('#device-browser')).toContainText('Chrome');
    await expect(page.locator('#device-cores')).toContainText('logical cores');
    await expect(page.locator('#device-name')).not.toHaveText('Compatible GPU');
    await expect(page.locator('#viewer')).not.toBeVisible();
    expect(scenes).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('library.png'), fullPage: true });
});

test('a scene card opens its setup screen with that scene\'s settings', async ({ page }, testInfo) => {
    const scenes: string[] = [];
    page.on('request', request => { if (request.url().includes('/scenes/')) scenes.push(request.url()); });
    await page.goto('/');
    await page.locator('.scene-card[data-scene="sponza"]').click();
    await expect(page).toHaveURL(/#\/scene\/sponza$/);
    await expect(page.getByRole('heading', { name: 'Sponza', exact: true })).toBeVisible();
    await expect(page.locator('#view-library')).toBeHidden();
    await expect(sceneNav(page, 'Sponza')).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('Render resolution').selectOption('1440p');
    await page.getByLabel('Point lights', { exact: true }).fill('2500');
    await expect(page.locator('#light-value')).toHaveText('2,500');
    expect(scenes).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('setup.png'), fullPage: true });

    await page.getByRole('link', { name: 'All simulations' }).first().click();
    await expect(page.locator('#view-library')).toBeVisible();
    await sceneNav(page, 'Orrery').click();
    await expect(page.locator('#spec-renderer')).toHaveText('Ray-marched SDF');
    await expect(page.locator('#light-settings')).toBeHidden();
});

test('mobile layout fits the viewport and keeps actions accessible', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/scene/sponza');
    await expect(page.getByRole('button', { name: 'Run benchmark' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(sceneNav(page, 'Sponza')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('unsupported browsers can inspect the library with a useful explanation', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await page.goto('/');
    await expect(page.locator('#compatibility')).toContainText('WebGPU-compatible browser');
    await expect(page.locator('.scene-card img').first()).toBeVisible();
    await page.locator('.scene-card[data-scene="sponza"]').click();
    await expect(page.getByRole('button', { name: 'Run benchmark' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Preview scene' })).toBeDisabled();
});

test('preview renders with a live graph, closes, and reopens at a different resolution', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/#/scene/sponza');
    await expect(page.locator('#gpu-status')).toContainText('WebGPU ready');
    await page.getByRole('button', { name: 'Preview scene' }).click();
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#live-metrics')).toContainText('FPS');
    await expect(page.locator('#live-graph')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('preview.png') });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#viewer')).toBeHidden();
    await page.getByLabel('Render resolution').selectOption('1440p');
    await page.getByRole('button', { name: 'Preview scene' }).click();
    await expect(page.locator('#live-metrics')).toContainText('FPS');
    await page.keyboard.press('Escape');
    await expect(page.locator('#viewer')).toBeHidden();
    expect(errors).toEqual([]);
});

test('Sponza benchmark can be cancelled and restarted, then shows results and exports them', async ({ page }) => {
    await page.goto('/#/scene/sponza');
    await expect(page.locator('#gpu-status')).toContainText('WebGPU ready');
    await page.getByRole('button', { name: 'Run benchmark' }).click();
    await expect(page.locator('#benchmark-progress')).toContainText('Testing with', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#viewer')).toBeHidden();
    await expect(page.locator('#view-scene')).toBeVisible();
    await expect(sceneNav(page, 'Results')).toBeHidden();
    await page.getByRole('button', { name: 'Run benchmark' }).click();
    await expect(page.locator('#view-results')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/#\/results$/);
    await expect(page.locator('#result-rows tr')).toHaveCount(10);
    await expect(page.locator('#score')).toBeHidden();
    await expect(page.locator('#frame-chart svg')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^renderrank-sponza-1080p-.*\.csv$/);
});

test('Orrery renders its camera path without loading scene assets, then switches back to Sponza', async ({ page }, testInfo) => {
    const errors: string[] = [];
    const scenes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.url().includes('/scenes/')) scenes.push(request.url()); });
    await page.goto('/#/scene/orrery');
    await expect(page.locator('#gpu-status')).toContainText('WebGPU ready');
    await page.getByRole('button', { name: 'Preview scene' }).click();
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#viewer-help')).toContainText('Fixed camera path');
    await expect(page.locator('#live-metrics')).toContainText('FPS', { timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath('orrery.png') });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#viewer')).toBeHidden();
    expect(scenes).toEqual([]);

    await sceneNav(page, 'Sponza').click();
    await expect(page.locator('#light-settings')).toBeVisible();
    await page.getByRole('button', { name: 'Preview scene' }).click();
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#live-metrics')).toContainText('FPS');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
});

test('Orrery benchmark shows a score and graph, exports, and uploads to the server', async ({ page }) => {
    // The real endpoint writes a file on the server; the test only checks what the page sends
    let uploaded: any;
    await page.route('**/api/results', async route => {
        uploaded = route.request().postDataJSON();
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'test-result' }) });
    });
    await page.goto('/#/scene/orrery');
    await expect(page.locator('#gpu-status')).toContainText('WebGPU ready');
    await page.getByRole('button', { name: 'Run benchmark' }).click();
    await expect(page.locator('#benchmark-progress')).toContainText('Shot 1 of 4', { timeout: 30_000 });
    await expect(page.locator('#view-results')).toBeVisible({ timeout: 70_000 });
    await expect(page.locator('#result-label')).toHaveText('Shot');
    await expect(page.locator('#result-rows tr')).toHaveCount(4);
    await expect(page.locator('#score-label')).toHaveText('ORRERY 1080P SCORE');
    // A software adapter may be too slow to finish a frame in every shot, which shows a dash instead of a number
    await expect(page.locator('#score-value')).toHaveText(/^[\d,]+$|^—$/);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^renderrank-orrery-1080p-.*\.csv$/);

    await page.getByRole('button', { name: 'Upload score' }).click();
    await expect(page.locator('#upload-status')).toContainText('test-result');
    await expect(page.getByRole('button', { name: 'Uploaded' })).toBeDisabled();
    expect(uploaded.scene.id).toBe('orrery');
    expect(uploaded.rows).toHaveLength(4);
    expect(uploaded.device.userAgent).toContain('Chrome');
    expect(uploaded.device.summary.cores).toContain('logical cores');

    await page.getByRole('link', { name: 'Back to scene' }).click();
    await expect(page.locator('#last-result')).toBeVisible();
});
