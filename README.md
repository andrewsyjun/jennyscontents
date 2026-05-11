# Jenny's Contents

Jenny's Contents is a small static app for launching and operating a daily real estate content workflow across X, Instagram, and TikTok.

## What it does

- Tracks setup tasks for X, Instagram, and TikTok accounts.
- Stores brand basics, content pillars, handles, and account status in local browser storage.
- Builds the morning content strategy prompt from the provided strategy brief.
- Captures three daily reel ideas with hook, format, caption, and CTA.
- Copies or downloads the daily filming brief as Markdown.

## Run locally

Open `index.html` in a browser.

No install step is required.

## Account setup notes

The app links to the public signup and business/analytics pages for each platform. Account creation still needs to be completed in the browser by the account owner because each platform requires identity, phone/email verification, passwords, and two-factor authentication setup.

Recommended handle pattern:

- X: `@JennyJunHomes`
- Instagram: `@jennyjunhomes`
- TikTok: `@jennyjunhomes`

Recommended bio starter:

> Helping buyers, sellers, and relocating families make confident moves in the Chicago suburbs. DM HOME for the local guide.

## API and automation roadmap

The current version is intentionally dependency-free and does not scrape social platforms. To automate the full prompt, add a backend and connect:

- X API for public post search and account analytics.
- Meta Instagram Graph API for Instagram insights.
- TikTok for Developers or TikTok Business tools for account insights.
- Google Drive API for saving briefs into the `Content` folder.

Each of those services requires separate developer approval and OAuth credentials.
