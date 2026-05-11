# Data Access Setup

Use this guide to connect Jenny's Contents to the accounts you created for X, Instagram, and TikTok.

Do not paste platform tokens into chat or commit them to Git. Store credentials in a local `.env` file only.

## What The App Can Access

| Platform | Best official access path | Good for | Main limitation |
| --- | --- | --- | --- |
| X | X API app with Bearer token | Public search from the last 7 days, public engagement metrics, your own public posts | Paid/API tier limits can affect volume and metrics |
| Instagram | Meta Instagram API with Instagram Login | Your own professional profile, media, comments, insights | Requires Business or Creator account; public trend discovery is limited |
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

## X Setup

1. Go to the X Developer Console: <https://console.x.com/>.
2. Create a Project and App named `jennyscontents`.
3. Choose a use case like: "Analyze public real estate posts and my account's public content to generate daily content ideas."
4. Generate the app credentials.
5. Copy the Bearer Token into `.env` as `X_BEARER_TOKEN`.
6. Add the account handle without `@` as `X_USERNAME`.

Start read-only. For the current strategy workflow, the first useful endpoint is recent search:

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

For owned content analysis, pull media and insights from:

```text
GET https://graph.instagram.com/{version}/{ig-user-id}/media
GET https://graph.instagram.com/{version}/{ig-media-id}/insights
GET https://graph.instagram.com/{version}/{ig-user-id}/insights
```

Important notes:

- Instagram insights require Business or Creator accounts.
- Some account-level metrics require enough follower/activity volume.
- User metrics are generally limited to recent windows, so export regularly.
- Hashtag/public trend endpoints are more constrained than X search and may require the Facebook Login path plus app review.

## TikTok Setup

1. Go to TikTok for Developers: <https://developers.tiktok.com/>.
2. Create an app named `jennyscontents`.
3. Add Login Kit.
4. Add Display API access.
5. Request these scopes:

```text
user.info.basic
user.info.profile
user.info.stats
video.list
```

6. Complete OAuth with the TikTok account.
7. Save the user access token as `TIKTOK_ACCESS_TOKEN`.
8. Save the handle without `@` as `TIKTOK_USERNAME`.

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
