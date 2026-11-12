# Accounts: Sign in with Google

RenderRank signs people in with Google Identity Services (GIS), entirely in the browser. The site stays a static build on GitHub Pages: there's no backend, no client secret, and nothing to deploy besides the page.

## How it works

1. **Sign in** in the top bar opens a small panel. Only then does the page load Google's script (`https://accounts.google.com/gsi/client`), so visitors who don't sign in never contact Google's sign-in service.
2. Google draws its own **Continue with Google** button. After the person picks an account in Google's popup, Google returns a signed **ID token** (a JWT) issued to RenderRank's OAuth client ID.
3. `src/auth.ts` decodes the token and checks that it is for this client (`aud`), comes from Google (`iss`), hasn't expired, and has a verified email. It then stores the email, name, and token in `localStorage`.
4. The account stays signed in until **Sign out**, which clears it. On later visits, the page shows the account without loading Google's script.

The ID token expires after an hour, and `idToken()` returns it only while it's valid. Nothing on the page depends on it yet; it only says who's signed in.

## When results get an API

The page can't keep a secret, so it can't be the party that trusts the token. A future API should:

- Receive the ID token (`idToken()` from `src/auth.ts`) as `Authorization: Bearer <token>`.
- Verify the token's signature against Google's public keys, and check `aud` equals the client ID, `iss` is `accounts.google.com` or `https://accounts.google.com`, and `exp` is in the future. Use a maintained library (`google-auth-library` on Node), or an API Gateway JWT authorizer with issuer `https://accounts.google.com` and audience set to the client ID.
- Identify users by the token's `sub` claim (stable per Google account), not by email.
- Handle expiry by asking the person to sign in again (or by adding One Tap with `auto_select` to refresh silently).

## Setup: create the OAuth client ID

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use the team's).
2. **APIs & Services → OAuth consent screen**: app name *RenderRank*, user type *External*, and support and developer contact emails. Basic sign-in scopes (`openid`, `email`, `profile`) need no verification review. While the app is in *Testing* status, only listed test users can sign in. Publish it to let anyone sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*. Add **Authorized JavaScript origins**:
   - `https://renderrank.github.io` (GitHub Pages)
   - `https://renderrank.tonyxtian.com`
   - `http://127.0.0.1:5174` (local development: the address `npm run dev` opens)
   - Optionally, `http://localhost` and `http://localhost:5174`, if you'd rather open the dev server as `localhost`. Google needs both of these entries.

   The origin must match the browser's address bar exactly. Opening the page from an unlisted address fails with `Error 400: origin_mismatch`.

   No redirect URIs are needed, because the popup flow returns the token to the page.
4. Copy the **client ID** (`….apps.googleusercontent.com`). It's public, not a secret.
   - Locally: put `VITE_GOOGLE_CLIENT_ID=<id>` in `.env.local`, restart `npm run dev`, and use the page it opens (`http://127.0.0.1:5174/`).
   - Deployed: add a repository variable `VITE_GOOGLE_CLIENT_ID` under **Settings → Secrets and variables → Actions → Variables**. The Pages workflow passes it to the build.

Without a client ID, the site builds without accounts and hides Sign in.

## Testing

Browser tests serve a fake GIS script (`tests/fake-google.ts`) in place of Google's and never contact Google. The test server is built with a fake client ID (`playwright.config.ts`).
