import { expect, test } from '@playwright/test';

test('root opens the library without fetching or starting Sponza', async ({ page }, testInfo) => {
    const scenes: string[] = [];
    page.on('request', request => { if (request.url().includes('/scenes/')) scenes.push(request.url()); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Simulations', exact: true })).toBeVisible();
    await expect(page.locator('.scene-card')).toHaveCount(1);
    await expect(page.locator('.scene-card')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('navigation', { name: 'Scenes' }).getByRole('button', { name: 'Sponza' })).toBeVisible();
    await expect(page.locator('.sidebar')).not.toContainText('WORKSPACE');
    await expect(page.locator('#device-system')).not.toHaveText('—');
    await expect(page.locator('#device-browser')).toContainText('Chrome');
    await expect(page.locator('#device-cores')).toContainText('logical cores');
    await expect(page.locator('#device-name')).not.toHaveText('Compatible GPU');
    await expect(page.locator('#viewer')).not.toBeVisible();
    await page.getByLabel('Render resolution').selectOption('1440p');
    await page.getByLabel('Point lights', { exact: true }).fill('2500');
    await expect(page.locator('#light-value')).toHaveText('2,500');
    expect(scenes).toEqual([]);
    await page.locator('h1').click();
    await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
});

test('mobile layout fits the viewport and keeps actions accessible', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Run benchmark' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('navigation', { name: 'Scenes' }).getByRole('button', { name: 'Sponza' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('unsupported browsers can inspect the library with a useful explanation', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Run benchmark' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Preview scene' })).toBeDisabled();
    await expect(page.locator('#compatibility')).toContainText('WebGPU-compatible browser');
    await expect(page.locator('.scene-card img')).toBeVisible();
});

test('preview renders, closes, and reopens at a different resolution', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/');
    await expect(page.locator('#gpu-status')).toContainText('WebGPU ready');
    await page.getByRole('button', { name: 'Preview scene' }).click();
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#live-metrics')).toContainText('FPS');
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

test('benchmark can be cancelled and restarted, then exports its results', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#gpu-status')).toContainText('WebGPU ready');
    await page.getByRole('button', { name: 'Run benchmark' }).click();
    await expect(page.locator('#benchmark-progress')).toContainText('Testing with', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#viewer')).toBeHidden();
    await expect(page.locator('#results')).toBeHidden();
    await page.getByRole('button', { name: 'Run benchmark' }).click();
    await expect(page.locator('#results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#result-rows tr')).toHaveCount(10);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^renderrank-sponza-1080p-.*\.csv$/);
});
