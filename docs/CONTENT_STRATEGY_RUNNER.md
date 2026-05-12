# Daily Content Strategy Runner

Run this every morning before filming:

```bash
npm run strategy:daily
```

The runner writes a Markdown report to `content-strategy/YYYY-MM-DD-content-strategy.md`.

It uses official data sources only:

- Instagram owned media and available media insights.
- Instagram hashtag discovery only when `INSTAGRAM_AUTH_MODE=facebook_login` and `INSTAGRAM_HASHTAG_DISCOVERY=true`.
- TikTok owned public videos through Display API.
- Manual trend examples from `data/manual-trends.json` when public trend APIs are unavailable.

## Manual Public Trend Input

TikTok Display API does not provide broad public search. Instagram public discovery does not expose saves or shares for competitor posts. Until approved public discovery access exists, copy `data/manual-trends.example.json` to `data/manual-trends.json` and add a few examples found manually:

```bash
cp data/manual-trends.example.json data/manual-trends.json
```

The runner will merge those examples with API data and clearly mark them as `manual_research`.

## Google Drive Upload

To save reports to the Drive `Content` folder, set these in `.env` or GitHub Actions secrets:

```text
GOOGLE_DRIVE_UPLOAD=true
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_CONTENT_FOLDER_ID=
```

To create the refresh token locally:

1. Create a Google Cloud OAuth client for a desktop app.
2. Put its client ID and client secret in `.env`.
3. Run:

```bash
npm run drive:auth
```

4. Open the printed URL, approve Drive file access, and let the localhost callback finish. The script writes `GOOGLE_DRIVE_REFRESH_TOKEN` to `.env`.

Use the folder ID from the Drive URL for the `Content` folder. For example:

```text
https://drive.google.com/drive/folders/FOLDER_ID_HERE
```

The runner uploads a Markdown file to that folder. It does not print Google tokens.

## Scheduling

For now, run the command locally each morning:

```bash
npm run strategy:daily
```

It can be moved to GitHub Actions later, but the GitHub token used for this repo needs the `workflow` permission before a scheduled workflow file can be pushed.
