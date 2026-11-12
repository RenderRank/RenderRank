// A stand-in for Google Identity Services. page.route serves it in place of https://accounts.google.com/gsi/client,
// and the test dev server is built with testClientId (playwright.config.ts), so the page runs its real sign-in code.
import type { Page } from '@playwright/test';

export const testClientId = 'test-client.apps.googleusercontent.com';
export const testEmail = 'tester@example.com';

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

// Unsigned: the page only decodes the ID token. Verifying the signature is a backend's job.
export function googleIdToken(claims: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return [
        base64url({ alg: 'RS256', typ: 'JWT' }),
        base64url({ iss: 'https://accounts.google.com', aud: testClientId, sub: '1234567890', email: testEmail, email_verified: true, name: 'Test Person', iat: now, exp: now + 3600, ...claims }),
        'signature',
    ].join('.');
}

// Its rendered button signs in immediately with `credential`, as if the person picked an account in Google's popup
export async function fakeGoogle(page: Page, credential = googleIdToken()) {
    const seen = { scriptLoads: 0, initialized: [] as Record<string, unknown>[], disabledAutoSelect: 0 };
    await page.exposeFunction('__recordGoogle', (kind: string, detail: Record<string, unknown>) => {
        if (kind === 'initialize') seen.initialized.push(detail);
        if (kind === 'disableAutoSelect') seen.disabledAutoSelect++;
    });
    await page.route('https://accounts.google.com/gsi/client', route => {
        seen.scriptLoads++;
        return route.fulfill({
            contentType: 'text/javascript',
            body: `(() => {
                let config;
                const record = window.__recordGoogle;
                window.google = { accounts: { id: {
                    initialize(options) { config = options; const { callback, ...rest } = options; record('initialize', rest); },
                    renderButton(parent) {
                        const button = document.createElement('button');
                        button.textContent = 'Continue with Google';
                        button.addEventListener('click', () => config.callback({ credential: ${JSON.stringify(credential)} }));
                        parent.append(button);
                    },
                    disableAutoSelect() { record('disableAutoSelect', {}); },
                } } };
            })();`,
        });
    });
    return seen;
}
