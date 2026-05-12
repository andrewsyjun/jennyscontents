# Jenny's Contents

Jenny's Contents is a small static app for launching and operating a daily real estate content workflow across X, Instagram, and TikTok.

## What it does

- Tracks setup tasks for X, Instagram, and TikTok accounts.
- Stores brand basics, content pillars, handles, and account status in local browser storage.
- Builds the morning content strategy prompt from the provided strategy brief.
- Captures three daily reel ideas with hook, format, caption, and CTA.
- Copies or downloads the daily filming brief as Markdown.

## Run locally

The private operating mode is local. This mode can exchange OAuth codes with platform app secrets
stored in `.env`.

```bash
cd /Users/andrewjun/work/home/jennyscontents
npm start
```

Then open:

```text
http://127.0.0.1:4173/
```

## Account setup notes

The app links to the public signup and business/analytics pages for each platform. Account creation still needs to be completed in the browser by the account owner because each platform requires identity, phone/email verification, passwords, and two-factor authentication setup.

Recommended handle pattern:

- X: `@JunResidential`
- Instagram: `@junresidentialgroup`
- TikTok: `@junresidential`

Recommended bio starter:

> Helping buyers, sellers, and relocating families make confident moves in North Dallas and across DFW. DM DFW for the local guide.

## API and automation roadmap

The current version is intentionally dependency-free and does not scrape social platforms. Data access setup lives in [`docs/DATA_ACCESS.md`](./docs/DATA_ACCESS.md), and credentials should only be stored in a local `.env`.

To validate social API credentials locally:

```bash
cp .env.example .env
npm run check:access
npm run check:access -- --platform x
```

To generate the morning content strategy report:

```bash
npm run strategy:daily
```

The runner saves a local Markdown report and can upload it to Google Drive when Drive credentials are configured. See [`docs/CONTENT_STRATEGY_RUNNER.md`](./docs/CONTENT_STRATEGY_RUNNER.md).

The local app also exposes a private Instagram summary endpoint at:

```text
http://127.0.0.1:4173/api/instagram/summary
```

The browser uses this endpoint to show connected-account status, recent media metrics, hook patterns, topic categories, and source warnings without exposing Instagram tokens to client-side JavaScript.

For Instagram Hashtag Search, configure `META_APP_ID`, `META_APP_SECRET`, and `FACEBOOK_REDIRECT_URI` in `.env`, add that redirect URI to Facebook Login for Business settings in Meta, then use the app's `Connect Facebook Login` button. Use `http://localhost:4173/auth/facebook/callback` for Facebook Login because Meta enforces HTTPS except for its local-development localhost exception. The callback updates `.env` for the Facebook Login path without printing token values.

## GitHub Pages review build

GitHub Pages can be enabled temporarily for Meta App Review:

```text
https://andrewsyjun.github.io/jennyscontents/
```

Use this public callback URL in Meta's Facebook Login for Business settings:

```text
https://andrewsyjun.github.io/jennyscontents/auth/facebook/callback/
```

The GitHub Pages build is review-only. It does not contain an app secret and cannot create a
long-lived token. Instead, it uses Facebook Login's browser redirect to store a short-lived token in
the reviewer's browser session storage, then calls Graph API directly from the page. This keeps the
public site testable for Meta without publishing private credentials. Use the local server for normal
operation.

To automate the full prompt, add a backend and connect:

- X API for public post search and account analytics.
- Meta Instagram Graph API for Instagram insights.
- TikTok for Developers or TikTok Business tools for account insights.
- Google Drive API for saving briefs into the `Content` folder.

Each of those services requires separate developer approval and OAuth credentials.
