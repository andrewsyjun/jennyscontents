# Data Access Setup

Use this guide to connect Jenny's Contents to X first, then Instagram, then TikTok.

Do not paste platform tokens into chat or commit them to Git. Store credentials in a local `.env` file only.

Official docs checked: May 11, 2026.

## What The App Can Access

| Platform | Best official access path | Good for | Main limitation |
| --- | --- | --- | --- |
| X | X API app with Bearer token | Public search from the last 7 days, public engagement metrics, your own public posts | Pay-per-use credits, rate limits, and endpoint access can affect volume |
| Instagram | Meta Instagram API with Instagram Login, plus optional Hashtag Search through the Facebook Login path | Your own professional profile, media, comments, insights; limited public hashtag discovery | Requires Business or Creator account; public discovery does not expose saves/shares |
| TikTok | TikTok Login Kit + Display API | Your own profile and public video metadata | Broad public video search requires Research API approval |

## Local Credentials

From the repo root:

```bash
cp .env.example .env
```

Fill in `.env` locally. The `.env` file is ignored by Git.

Run the access check:

```bash
npm run check:access
```

The script skips any platform whose token is blank.

Check one platform:

```bash
npm run check:access -- --platform x
npm run check:access -- --platform instagram
npm run check:access -- --platform tiktok
```

Use `--strict` when you want CI-style failure for missing selected credentials:

```bash
npm run check:access -- --platform x --strict
```

## Content Strategy Data Reality

The strategy prompt asks for:

```text
Search Instagram and TikTok for the top performing real estate reels and carousels of the last 7 days.
Identify the hook patterns getting saves and shares, the format structures, and the topic categories resonating.
```

Use official APIs, but do not assume every metric is available for public competitor content.

For Instagram:

- Your own account: use Instagram media and media insights. This is where saves, shares, reach, plays/views, comments, likes, and carousel/reel performance are most useful when the metric is available for that media type.
- Public discovery: use Hashtag Search only for a small fixed set of real estate hashtags. Query `top_media` and `recent_media`, then rank by the public metrics the API returns, usually likes and comments. Saves and shares are not available for public hashtag results.
- Hashtag Search is limited to 30 unique hashtags per Instagram Business or Creator account in a rolling 7-day period. Re-querying the same hashtag during that window does not count as a new unique hashtag.
- Treat public Instagram results as signal discovery, not a complete ranking of all real estate reels and carousels.

Recommended starter hashtag set:

```text
dfwrealestate
dallasrealestate
northdallas
dallasrealtor
dfwrealtor
planotx
friscotx
mckinneytx
realtor
realestateagent
homebuyer
homeseller
firsttimehomebuyer
listingagent
openhouse
```

For TikTok:

- Your own account: use Display API `user/info`, `video/list`, and `video/query` to read your profile and video metadata.
- Broad public discovery: use Research API only if TikTok approves the project. The research video query endpoint can filter by keyword or hashtag, date range, region, and metrics such as views, likes, comments, shares, and favorites.
- If Research API access is not approved, collect TikTok trend examples manually and normalize them into the same data model. Do not scrape TikTok pages.

Practical ranking:

1. Owned posts: rank by saves, shares, views, and engagement rate.
2. Instagram hashtag results: rank by likes, comments, recency, format, and caption/hook quality.
3. TikTok Research API results, if approved: rank by views, shares, favorites, comments, and likes from the last 7 days.
4. Manual TikTok/Instagram examples: mark `source` as `manual_research` and include notes for hook, first three seconds, and format.

## X Setup

1. Go to the X Developer Console: <https://console.x.com/>.
2. Sign in with Jenny's X account or the account that will own API billing.
3. Accept the developer agreement and complete the developer profile.
4. Create an app named `jennyscontents`.
5. Use a read-only use case like: "Analyze public real estate posts and my account's public content to generate daily content ideas."
6. Generate credentials and save them immediately. X only shows some credentials once.
7. Copy the Bearer Token into `.env` as `X_BEARER_TOKEN`.
8. Add the account handle without `@` as `X_USERNAME`.

Validate the token without running recent search:

```bash
npm run check:access -- --platform x --strict
```

This checks:

```text
GET https://api.x.com/2/users/by/username/{username}
```

The X docs describe Bearer tokens as app-only authentication for reading public data. Use that first before OAuth user-context access.

For the current strategy workflow, the first useful X data endpoint is recent search:

```text
GET https://api.x.com/2/tweets/search/recent
```

Recommended query pattern:

```text
("real estate" OR realtor OR homebuyer OR homeseller) lang:en -is:retweet has:videos
```

Request fields:

```text
tweet.fields=created_at,public_metrics,author_id,text
expansions=author_id
user.fields=username,public_metrics,verified
```

Recent search is opt-in in the local checker because X API calls can count against usage/credits. Run it only after the basic token check passes:

```bash
npm run check:access -- --platform x --full
```

or set this in `.env`:

```text
X_CHECK_RECENT_SEARCH=true
```

Common X validation failures:

- `401`: regenerate or recopy the Bearer Token.
- `403`: confirm the app is approved and the endpoint is available for the app's current access.
- `429`: wait for the rate limit window or check usage/credits in the Developer Console.

## Instagram Setup

1. Make sure the Instagram account is a Professional account: Business or Creator.
2. Go to Meta for Developers: <https://developers.facebook.com/>.
3. Create an app named `jennyscontents`.
4. Add the Instagram product.
5. Use Instagram API with Instagram Login for your own profile and media insights.
6. Request the minimum useful scopes:

```text
instagram_business_basic
instagram_business_manage_insights
instagram_business_manage_comments
```

Add publishing later only if the app will post for you:

```text
instagram_business_content_publish
```

7. Generate or complete OAuth for an Instagram User access token.
8. Save the token as `INSTAGRAM_ACCESS_TOKEN`.
9. Save the professional account id as `INSTAGRAM_USER_ID`.
10. Save the handle without `@` as `INSTAGRAM_USERNAME`.

If Instagram Login token generation gets stuck or returns an unexpected login error, switch to the **API setup with Facebook login** path. This is also the better path for hashtag discovery and broader insights.

Facebook Login requirements:

- The Instagram account must be Professional: Business or Creator.
- The Instagram account must be connected to a Facebook Page.
- The Facebook account completing OAuth must have a Page task such as manage, create content, moderate, or advertise on the connected Page.

For Facebook Login, request at least:

```text
instagram_basic
pages_show_list
```

Then add the Instagram permissions needed by the workflow:

```text
instagram_manage_insights
instagram_manage_comments
```

Save Facebook Login tokens with:

```text
INSTAGRAM_AUTH_MODE=facebook_login
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_USER_ID=
INSTAGRAM_USERNAME=
INSTAGRAM_PAGE_ID=
```

To discover the connected Instagram user id from a Page id:

```text
GET https://graph.facebook.com/{version}/{page-id}?fields=instagram_business_account{id,username}
```

For owned content analysis, pull media and insights from:

```text
GET https://graph.instagram.com/{version}/{ig-user-id}/media
GET https://graph.instagram.com/{version}/{ig-media-id}/insights
GET https://graph.instagram.com/{version}/{ig-user-id}/insights
```

For limited public hashtag discovery, use the Instagram API with Facebook Login path:

```text
GET https://graph.facebook.com/{version}/ig_hashtag_search
GET https://graph.facebook.com/{version}/{ig-hashtag-id}/top_media
GET https://graph.facebook.com/{version}/{ig-hashtag-id}/recent_media
```

Use hashtag discovery as an input to the strategy prompt, but do not expect it to return private insights such as saves and shares for other accounts.

Important notes:

- Instagram insights require Business or Creator accounts.
- Some account-level metrics require enough follower/activity volume.
- User metrics are generally limited to recent windows, so export regularly.
- Hashtag/public trend endpoints are more constrained than X search and may require the Facebook Login path plus app review.
- Standard access is enough when the app only serves Instagram professional accounts you own or manage and have added in the app dashboard. Serving accounts you do not own/manage requires Advanced Access.

## TikTok Setup

1. Go to TikTok for Developers: <https://developers.tiktok.com/>.
2. Create an app named `jennyscontents`.
3. Add Login Kit.
4. For local-only use, add Desktop as the platform.
5. Use this redirect URI:

```text
http://127.0.0.1:4173/auth/tiktok/callback
```

TikTok Web Login Kit redirect URIs must use HTTPS. TikTok Desktop Login Kit allows localhost or loopback HTTP redirect URIs with a port, so use Desktop mode for the local-only app.

6. Add these minimum scopes:

```text
user.info.basic
video.list
```

Optional profile/stat scopes can be added later if the app needs username, bio, follower count, or total video count:

```text
user.info.profile
user.info.stats
```

7. Add the TikTok account under Sandbox settings -> Target Users before testing OAuth in sandbox.
8. Save the sandbox client key, client secret, and redirect URI in `.env`.
9. Complete OAuth with the TikTok account.
10. Start the local app before testing OAuth:

```bash
npm start
```

11. If the local callback page URL contains `code=`, OAuth succeeded. Use the full callback URL locally and do not paste it into chat.
12. Exchange the callback code for tokens:

```bash
npm run tiktok:exchange -- 'http://127.0.0.1:4173/auth/tiktok/callback?code=...&state=jennyscontents'
```

The exchange helper writes `TIKTOK_ACCESS_TOKEN`, `TIKTOK_REFRESH_TOKEN`, and `TIKTOK_OPEN_ID` to `.env` without printing token values.
13. Save the handle without `@` as `TIKTOK_USERNAME` if you want validator output to show a stable handle.

For owned content analysis, use:

```text
GET https://open.tiktokapis.com/v2/user/info/
GET https://open.tiktokapis.com/v2/video/list/
POST https://open.tiktokapis.com/v2/video/query/
```

Request video fields:

```text
id,create_time,share_url,video_description,duration,like_count,comment_count,share_count,view_count
```

Broad public TikTok research is different from your own account analytics. TikTok's Research API requires a separate approval process and is intended for qualifying independent/non-commercial research. For normal creator strategy, use your own TikTok analytics plus manual/topical observation until approved access is available.

The Display API video list endpoint accepts `max_count` in the JSON request body and currently caps it at 20 per page.

## Analysis Data Model

Normalize each platform into this shape before asking the content strategy prompt to evaluate it:

```json
{
  "platform": "instagram",
  "source": "owned_media",
  "post_id": "string",
  "url": "string",
  "created_at": "ISO timestamp",
  "caption_or_text": "string",
  "format": "reel | carousel | post | short_video | text",
  "views": 0,
  "likes": 0,
  "comments": 0,
  "shares": 0,
  "saves": 0,
  "hook_notes": "manual or model-derived notes"
}
```

For your prompt, prioritize:

1. Saves and shares when available.
2. View-to-engagement rate.
3. Hook text and first three seconds.
4. Repeatable format pattern.
5. Topic category.

## Source Links

- X Developer access: <https://docs.x.com/x-api/getting-started/getting-access>
- X recent search quickstart: <https://docs.x.com/x-api/posts/search/quickstart/recent-search>
- X apps and credentials: <https://docs.x.com/fundamentals/developer-apps>
- Instagram API with Instagram Login: <https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/>
- Instagram insights: <https://developers.facebook.com/docs/instagram-platform/insights/>
- Instagram Hashtag Search: <https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search/>
- TikTok scopes: <https://developers.tiktok.com/doc/tiktok-api-scopes>
- TikTok Display API overview: <https://developers.tiktok.com/doc/display-api-overview>
- TikTok video list endpoint: <https://developers.tiktok.com/doc/tiktok-api-v2-video-list/>
- TikTok Research API video query: <https://developers.tiktok.com/doc/research-api-specs-query-videos/>
