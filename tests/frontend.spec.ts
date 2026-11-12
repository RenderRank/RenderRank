import { expect, test } from '@playwright/test';
import { fakeGoogle, googleIdToken, testClientId, testEmail } from './fake-google';

const sceneNav = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation', { name: 'Scenes' }).getByRole('link', { name, exact: true });

test('root opens the library without fetching or starting a scene', async ({ page }, testInfo) => {
    const scenes: string[] = [];
    const google: string[] = [];
    page.on('request', request => {
        if (request.url().includes('/scenes/')) scenes.push(request.url());
        if (request.url().startsWith('https://accounts.google.com/')) google.push(request.url());
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Simulations', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('.scene-card')).toHaveCount(2);
    // The Orrery is listed first
    await expect(page.locator('.scene-card').first()).toHaveAttribute('data-scene', 'orrery');
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
    // Visitors who don't sign in never contact Google's sign-in service
    expect(google).toEqual([]);
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
    // Reference lines are labeled with their frame times, not frame rates
    await expect(page.locator('#live-graph-axis span').first()).toHaveText(/^\d+\.\d ms$/);
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
    await page.getByRole('button', { name: 'Export JSON' }).click();
    expect((await download).suggestedFilename()).toMatch(/^renderrank-sponza-1080p-.*\.json$/);
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

test('Orrery benchmark shows a score and graph, exports, uploads, and reopens from the saved file', async ({ page }) => {
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

    // The results screen shows the whole report; Export JSON saves exactly what it prints
    await expect(page.locator('#report .report-card')).toHaveCount(9);
    const printed = await page.locator('#report-json').textContent() ?? '';
    const shown = JSON.parse(printed);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^renderrank-orrery-1080p-.*\.json$/);
    const savedText = (await import('node:fs')).readFileSync(await saved.path(), 'utf8');
    expect(savedText).toBe(printed);
    // What the run looked like, to compare with the reopened file
    const screen = async () => page.locator('#view-results').evaluate(view => ['#results-heading', '#result-settings', '#score', '#frame-chart', '#result-rows', '#result-note', '#report']
        .map(selector => view.querySelector(selector)!.innerHTML));
    const original = await screen();

    await page.getByRole('button', { name: 'Upload score' }).click();
    await expect(page.locator('#upload-status')).toContainText('test-result');
    await expect(page.getByRole('button', { name: 'Uploaded' })).toBeDisabled();
    expect(uploaded).toEqual(shown);
    expect(uploaded.scene.id).toBe('orrery');
    expect(uploaded.rows).toHaveLength(4);
    expect(uploaded.device.userAgent).toContain('Chrome');
    expect(uploaded.device.summary.cores).toContain('logical cores');

    await page.getByRole('link', { name: 'Back to scene' }).click();
    await expect(page.locator('#last-result')).toBeVisible();

    // Opening the saved file from the library shows the same results screen
    await page.goto('/#/');
    await page.locator('#report-file').setInputFiles({ name: 'run.json', mimeType: 'application/json', buffer: Buffer.from(savedText) });
    await expect(page).toHaveURL(/#\/results$/);
    await expect(page.locator('#upload-status')).toHaveText('Opened from run.json');
    await expect(page.locator('#upload')).toBeHidden();
    expect(await screen()).toEqual(original);

    // Files the server saved wrap the report with their upload ID
    await page.goto('/#/');
    const fromServer = JSON.stringify({ id: 'server-copy', receivedAt: new Date().toISOString(), result: shown });
    await page.locator('#report-file').setInputFiles({ name: 'server.json', mimeType: 'application/json', buffer: Buffer.from(fromServer) });
    await expect(page.locator('#upload-status')).toHaveText('Opened from server.json · Saved on the server as server-copy');
    expect(await screen()).toEqual(original);

    // Anything else is refused with a reason, and the library stays put
    await page.goto('/#/');
    await page.locator('#report-file').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
    await expect(page.locator('#open-report-status')).toContainText('Couldn’t open notes.json');
    await expect(page.locator('#view-library')).toBeVisible();

    // A stress test report shows stability and one row per loop. A real one takes minutes, so this one is built
    // from the run above.
    const stressReport = {
        ...shown,
        score: null,
        stress: { loops: 2, loopScores: [10000, 9850], stability: 0.985, threshold: 0.97, passed: true, valid: true, note: 'Stress note' },
        rows: [{ ...shown.rows[0], label: 'Loop 1' }, { ...shown.rows[1], label: 'Loop 2' }],
    };
    await page.locator('#report-file').setInputFiles({ name: 'stress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stressReport)) });
    await expect(page.locator('#score-label')).toHaveText('ORRERY 1080P STRESS TEST');
    await expect(page.locator('#score-value')).toHaveText('98.5%');
    await expect(page.locator('#score-detail')).toContainText('Passed');
    await expect(page.locator('#table-title')).toHaveText('By loop');
    await expect(page.locator('#result-score')).toBeVisible();
    await expect(page.locator('#result-rows tr').first().locator('td').nth(1)).toHaveText('10,000');
});

test('Orrery stress test takes a loop count and can be stopped', async ({ page }) => {
    await page.goto('/#/scene/orrery');
    await expect(page.locator('#gpu-status')).toContainText('WebGPU ready');
    const loops = page.getByLabel('Loops', { exact: true });
    await expect(loops).toBeHidden();
    await page.getByLabel('Test', { exact: true }).selectOption('stress');
    await expect(loops).toHaveValue('20');
    await expect(page.locator('#run-note')).toContainText('20 times');
    // Out-of-range counts are pulled back into range
    await loops.fill('500');
    await loops.blur();
    await expect(loops).toHaveValue('100');
    await loops.fill('2');
    await expect(page.locator('#run-note')).toContainText('2 times back to back, which takes 80 seconds');
    await page.getByRole('button', { name: 'Run stress test' }).click();
    await expect(page.locator('#viewer-mode')).toHaveText('Stress test');
    await expect(page.locator('#benchmark-progress')).toContainText('Loop 1 of 2', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('#viewer')).toBeHidden();
    await expect(sceneNav(page, 'Results')).toBeHidden();
    // Sponza's benchmark is display-paced, so it has no stress test
    await sceneNav(page, 'Sponza').click();
    await expect(page.getByLabel('Test', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Run benchmark' })).toBeVisible();
});

test('Sign in with Google shows the account, survives a reload, and signs out', async ({ page }, testInfo) => {
    const google = await fakeGoogle(page);
    await page.goto('/#/scene/orrery');
    const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
    await signIn.click();
    await expect(signIn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sign-in.png') });
    await page.getByRole('button', { name: 'Continue with Google' }).click();

    await expect(page.locator('#account-email')).toHaveText(testEmail);
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeHidden();
    await expect(signIn).toBeHidden();
    await expect(page).toHaveURL(/#\/scene\/orrery$/);
    expect(google.scriptLoads).toBe(1);
    expect(google.initialized[0]).toMatchObject({ client_id: testClientId, ux_mode: 'popup', auto_select: false });

    await page.reload();
    await expect(page.locator('#account-email')).toHaveText(testEmail);
    // A remembered sign-in doesn't need Google's script
    expect(google.scriptLoads).toBe(1);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signIn).toBeVisible();
    await expect(page.locator('#account-email')).toHaveText('');
    await page.reload();
    await expect(signIn).toBeVisible();
});

test('sign-in rejects tokens that are not for this site and closes with Escape', async ({ page }) => {
    await fakeGoogle(page, googleIdToken({ aud: 'someone-else.apps.googleusercontent.com' }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page.locator('#sign-in-status')).toHaveText('The sign-in token is for a different site.');
    await expect(page.locator('#account-email')).toHaveText('');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
});

test('sign-in reports when Google can\'t be reached', async ({ page }) => {
    await page.route('https://accounts.google.com/gsi/client', route => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('#sign-in-status')).toContainText('Could not reach Google');
    await expect(page.locator('.scene-card')).toHaveCount(2);
});
