// Sign in with Google, entirely in the browser, through Google Identity Services (GIS). Google returns a signed ID
// token (a JWT) for this site's OAuth client; there is no client secret and no backend involved yet.
//
// The ID token is kept with the account so a future API can verify it (signature against Google's keys, `aud` equal to
// the client ID, `iss`, and expiry). Nothing on the page is protected by it: here it only says who is signed in.
//
// Configured by VITE_GOOGLE_CLIENT_ID at build time; without it, accounts are off. Google's script loads only when
// someone chooses Sign in, so visitors who don't sign in never contact Google.

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const accountsEnabled = Boolean(clientId);

export interface Account {
    email: string;
    name?: string;
}

interface StoredAccount extends Account {
    credential: string;
    expiresAt: number; // ms since epoch, from the ID token's exp
}

// The parts of the GIS API this uses (https://developers.google.com/identity/gsi/web/reference/js-reference)
interface GoogleIdentity {
    initialize(config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        ux_mode?: 'popup' | 'redirect';
        context?: 'signin' | 'signup' | 'use';
        use_fedcm_for_button?: boolean;
    }): void;
    renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
    disableAutoSelect(): void;
}
declare global {
    interface Window { google?: { accounts: { id: GoogleIdentity } } }
}

const storageKey = 'renderrank:account';
const scriptUrl = 'https://accounts.google.com/gsi/client';
const listeners = new Set<(account: Account | undefined) => void>();

export function onAccountChange(listener: (account: Account | undefined) => void) { listeners.add(listener); }
function notify(account: Account | undefined) { listeners.forEach(listener => listener(account)); }

function readStored(): StoredAccount | undefined {
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as StoredAccount | null;
        return stored && typeof stored.email === 'string' && typeof stored.credential === 'string' ? stored : undefined;
    } catch {
        return undefined;
    }
}

// The signed-in account, if any. It lasts until Sign out, even after the ID token itself expires (after an hour).
export function currentAccount(): Account | undefined {
    if (!accountsEnabled) return undefined;
    const stored = readStored();
    return stored && { email: stored.email, name: stored.name };
}

// The Google ID token, while it is still valid, for sending to an API. Undefined once expired; signing in again
// gets a fresh one.
export function idToken(): string | undefined {
    const stored = readStored();
    return stored && stored.expiresAt - Date.now() > 60_000 ? stored.credential : undefined;
}

// Reads the JWT payload. The signature isn't checked here (a page can't keep a secret, so it can't be the one that
// trusts the token); this only rejects tokens that plainly aren't for this site.
export function accountFromCredential(credential: string): StoredAccount {
    let claims: Record<string, unknown>;
    try {
        const payload = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        claims = JSON.parse(decodeURIComponent(Array.from(atob(payload), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
    } catch {
        throw new Error('Google sent an unreadable sign-in token.');
    }
    if (claims.aud !== clientId) throw new Error('The sign-in token is for a different site.');
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new Error('The sign-in token is not from Google.');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) throw new Error('The sign-in token has expired. Try again.');
    if (typeof claims.email !== 'string' || claims.email_verified !== true) throw new Error('Your Google account has no verified email address.');
    return {
        email: claims.email,
        name: typeof claims.name === 'string' ? claims.name : undefined,
        credential,
        expiresAt: claims.exp * 1000,
    };
}

let loading: Promise<GoogleIdentity> | undefined;
function loadGoogle(): Promise<GoogleIdentity> {
    loading ??= new Promise<GoogleIdentity>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.onload = () => window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not start.'));
        script.onerror = () => reject(new Error('Could not reach Google. Check your connection or content blocker.'));
        document.head.append(script);
    }).catch(error => { loading = undefined; throw error; });
    return loading;
}

// Draws Google's own "Continue with Google" button into `container`. Signing in through it stores the account and
// notifies listeners; `onError` hears about tokens that fail the checks above.
export async function renderSignInButton(container: HTMLElement, onError: (message: string) => void) {
    if (!accountsEnabled) return;
    const google = await loadGoogle();
    google.initialize({
        client_id: clientId!,
        ux_mode: 'popup',
        context: 'signin',
        auto_select: false,
        use_fedcm_for_button: true,
        callback: ({ credential }) => {
            try {
                const account = accountFromCredential(credential);
                localStorage.setItem(storageKey, JSON.stringify(account));
                notify({ email: account.email, name: account.name });
            } catch (error) {
                onError((error as Error).message);
            }
        },
    });
    container.replaceChildren();
    google.renderButton(container, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: 240 });
}

export function signOut() {
    try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    // Stops Google from silently picking this account next time, if its script is already on the page
    window.google?.accounts?.id?.disableAutoSelect();
    notify(undefined);
}
