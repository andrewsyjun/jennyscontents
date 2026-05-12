# Meta App Review Draft - Instagram Public Content Access

Status: draft for owner review. Do not submit until the GitHub Pages review build is enabled and the screen recording is ready.

## Current Blocker

Meta's app review prompt says the app must be loadable and testable externally. Use the temporary GitHub Pages review build:

```text
https://andrewsyjun.github.io/jennyscontents/
```

The public review callback URL is:

```text
https://andrewsyjun.github.io/jennyscontents/auth/facebook/callback/
```

The GitHub Pages build does not contain `META_APP_SECRET`. It uses a short-lived browser OAuth token stored in session storage only, then calls Graph API directly for reviewer testing. The private local build remains the normal operating mode for long-lived tokens and `.env` credentials.

## Requested Feature

Instagram Public Content Access

## Related Permissions Used By The App

```text
instagram_basic
pages_show_list
pages_read_engagement
```

The app uses Facebook Login to discover the Instagram Business account connected to the Facebook Page and then calls Instagram hashtag search endpoints. It does not request publishing or messaging permissions for this content strategy use case.

## App Description

Jenny's Contents is a private content strategy dashboard for Jun Residential Group, a real estate business serving North Dallas and the broader DFW market. The app helps the business review its own Instagram content performance and compare it with public real estate hashtag trends so Jenny can decide what to film each morning.

The app uses public Instagram hashtag data to identify high-performing real estate content patterns from the last seven days. It looks for repeatable hooks, formats, and topic categories across selected real estate hashtags such as `#dfwrealestate`, `#dallasrealestate`, `#northdallas`, `#dallasrealtor`, and `#dfwrealtor`.

The output is a concise daily filming brief with three reel ideas. Each idea includes a hook, format, caption draft, and CTA. Public hashtag results are used as trend signals only; the app does not repost content, automate engagement, message users, or create public profiles of Instagram users.

## Why Instagram Public Content Access Is Needed

The app needs Instagram Public Content Access because the content strategy workflow depends on discovering public Instagram posts associated with selected real estate hashtags. Without public content access, the app can only read Jenny's own account data, which is not enough to identify what real estate content is currently working across the market.

The app uses the access to:

1. Search a limited set of approved real estate hashtags.
2. Retrieve public `top_media` and `recent_media` results.
3. Read public metadata such as caption text, media type, timestamp, permalink, like count, and comment count when available.
4. Rank public examples by available public engagement proxies.
5. Summarize trends into content ideas for the authorized business owner.

The app does not attempt to access private Instagram content, private insights from other accounts, follower lists, direct messages, or any non-public user data.

## Data Handling

Stored locally:

- Meta OAuth access token in the local `.env` file.
- Connected Instagram Business account ID and username.
- Connected Facebook Page ID.
- Generated daily content strategy Markdown files.

Used transiently:

- Public hashtag media captions.
- Public media permalinks.
- Public media type and timestamp.
- Public like and comment counts when returned by the API.

Not collected:

- Direct messages.
- Follower lists.
- Private account content.
- Private insights for public hashtag posts.
- Saves or shares for public hashtag posts, because those are not exposed for competitor/public content.

## Reviewer Test Steps

Prerequisite: GitHub Pages is enabled and the Facebook Login for Business settings include the public callback URL.

1. Open `https://andrewsyjun.github.io/jennyscontents/`.
2. Confirm the dashboard shows the brand as `Jun Residential Group` and market as `North Dallas and DFW`.
3. Click `Connect Facebook Login`.
4. Complete Facebook Login with a Facebook account that has access to the `Jun Residential Group` Page connected to `@junresidentialgroup`.
5. Return to the app and confirm the Instagram panel shows `@junresidentialgroup (facebook login)`.
6. Click `Refresh Instagram`.
7. The GitHub Pages review build calls Graph API directly from the browser session, which:
   - Reads owned Instagram media for the connected account.
   - Runs Instagram hashtag search for the configured DFW/North Dallas real estate hashtags.
   - Fetches top public hashtag media after hashtag IDs are resolved.
   - Summarizes hook patterns, topic categories, format mix, and top public examples.
8. Review the `Content strategy prompt` section, which uses the available Instagram data to prepare the daily filming brief.

## Screen Recording Outline

Record a short video that shows:

1. Opening the review URL.
2. The dashboard brand and market settings.
3. The `Connect Facebook Login` button.
4. Completion of Facebook Login.
5. The Instagram panel showing the connected account.
6. `Refresh Instagram` triggering the Instagram data panel.
7. Public hashtag results if approved, or the current pre-approval error showing that Instagram Public Content Access is the blocked feature.
8. The content strategy prompt/brief that uses the retrieved data.

Do not show app secrets, OAuth tokens, `.env`, or credential pages in the recording.

## Current Validation Evidence

Local access validation passes:

```text
OK   Instagram: connected via facebook login as @junresidentialgroup; media returned 0 items
```

The current hashtag calls fail because Meta has not approved Instagram Public Content Access yet:

```text
(#10) To use 'Instagram Public Content Access', your use of this endpoint must be reviewed and approved by Facebook.
```

## Submission Notes Draft

Jenny's Contents is a private content strategy dashboard for Jun Residential Group, a real estate business in North Dallas and DFW. The app uses Facebook Login to connect the business owner's Instagram Business account, `@junresidentialgroup`, through the connected Jun Residential Group Facebook Page.

We are requesting Instagram Public Content Access so the app can search a limited set of public real estate hashtags and retrieve public top/recent media metadata. The app uses those public posts only as market trend signals. It analyzes hook language, media format, topic category, caption patterns, and public engagement proxies such as likes and comments. The output is a daily filming brief with three reel ideas for the business owner.

The app does not scrape Instagram, automate likes/comments/follows, publish content, send messages, build user profiles, sell data, or expose public content outside the business owner's dashboard. It does not access private content, private insights from other accounts, or direct messages. Public saves and shares are not requested because they are not available for public hashtag results.

The requested access benefits the authorized Instagram business user by helping them create more relevant, timely, local real estate content based on public market trends while keeping the workflow limited to a small set of DFW/North Dallas real estate hashtags.

## Do Not Submit Until

- [ ] GitHub Pages is enabled and loads `https://andrewsyjun.github.io/jennyscontents/`.
- [ ] Facebook Login for Business includes `https://andrewsyjun.github.io/jennyscontents/auth/facebook/callback/`.
- [ ] The review URL does not expose secrets.
- [ ] A screen recording is attached.
- [ ] Any required reviewer credentials are prepared outside the repo and not committed.
- [ ] The owner has reviewed and approved this draft.
