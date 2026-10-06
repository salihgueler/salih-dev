# Reader counts behind a feature flag

Status: in progress on `feat/reader-counts` (cut from `main` at `b3e19ad`, the PR #10 merge).

## What readers see

On a blog post page, under the post meta line:

> 3 reading now · 128 read so far

- **Reading now:** open tabs on this post that sent a heartbeat in the last 75 seconds.
- **Read so far:** distinct visitors (by `vid`) who opened this post, counted once each.
- The numbers refresh every 30 seconds while the tab is visible. It's polling, not
  WebSockets: at this traffic a 30 second refresh is enough, and it needs no new
  real-time service.
- If the API fails, the line hides itself. A broken counter never breaks the post.

## Flag

- New flag `readerCounts` in the existing AppConfig profile `render-flags`, next to
  `renderFromBackend`. Same application, environment, deployment strategy and the
  same three rollback alarms watching the environment.
- Starts off. Turned on out of band the same way: on for one `vid`, then `split`.
- Two places read it:
  1. **The page.** The render middleware reads `readerCounts` for the visitor's `vid`
     on the on path and passes it to the post page in `Astro.locals`. The widget and
     its script are only in the HTML when the flag is on.
  2. **The API.** The readers Lambda reads the same flag for the same `vid` and returns
     404 when it is off. So turning the flag off is also a kill switch for the API,
     not only for the markup.
- **Dependency:** the widget only appears on request-time renders, so it needs
  `renderFromBackend` on for that visitor too. Baked static pages never contain it.
- Fail-safe as before: any flag read error means off.

## API

`POST /api/readers/<slug>` through CloudFront to a Lambda Function URL behind OAC.
Same origin as the page, so no CORS.

- Body: `{"first": true}` on the first heartbeat of a page view, `{}` after.
- The browser sends `x-amz-content-sha256` with the SHA-256 of the body, because a
  Lambda Function URL behind OAC does not accept unsigned POST payloads.
- The `vid` cookie is `HttpOnly`, so the script can't read it. CloudFront forwards
  only the `vid` cookie to this origin and the Lambda reads it from the `Cookie`
  header. No cookie means 400.
- Response: `{"readingNow": n, "readSoFar": n}`, `Cache-Control: no-store`.
- The slug must be the shape of a post id and the post must exist in the content
  bucket (`posts/<slug>.md`), so nobody can create counters for made-up posts.
- CloudFront behavior `/api/readers/*`: no caching, POST allowed.

## Storage

One DynamoDB table `ReaderCounts` (on-demand, in the state stack, retained), TTL on
`expiresAt`.

| pk | sk | attributes | written when |
|---|---|---|---|
| `post#<slug>` | `now#<h>` | `expiresAt` = now + 75 s | every heartbeat (overwrite) |
| `post#<slug>` | `read#<h>` | `expiresAt` = now + 1 year | first heartbeat, only if absent |
| `post#<slug>` | `total` | `readSoFar` (number) | +1 in the same transaction as a new `read#` |

- `h = sha256(vid + ":" + slug)`. The table never stores the `vid` itself, and the
  same visitor gets an unrelated hash on every post, so the rows can't be joined
  across posts.
- `read#` rows expire after a year, the same as the cookie.
- "Reading now" is a `Query` on `begins_with(sk, "now#")` with a filter on
  `expiresAt > now`, `Select: COUNT`. The filter matters: TTL deletes expired items
  within days, not seconds, so expired rows still exist for a while.
- The new read is a `TransactWriteItems` of a conditional `Put` on `read#<h>` and an
  `ADD readSoFar 1` on `total`. A repeat visitor fails the condition and the counter
  doesn't move.

## Rollback

A fourth AppConfig monitor, `ReadersErrorsAlarm`, fires on two or more failures in a
minute: the readers Lambda's `Errors` plus handled `store_error` log lines (metric
`SalihDev/Readers StoreErrors`). A `readerCounts` deployment that breaks the API
rolls back like a render one.

## First deploy

The stack's own flag version is replaced (it now defines both flags), but nothing is
deployed. The live flag deployment doesn't contain `readerCounts`, so the agent
answers 404 and the flag reads as off until a new flag version that includes it is
deployed from the CLI (DEPLOY.md section 11).

## Known limits

- The account's Lambda concurrency limit is 10, shared by the render Lambda, the
  content API and the readers Lambda. Heartbeats compete with page renders. It's
  fine at this traffic, but a quota increase should come before a wide rollout.
- No rate limiting beyond CloudFront. A script could inflate "reading now" by
  minting cookies. The numbers are a fun signal, not analytics.
- Privacy: the hashed rows are pseudonymous data tied to the `vid` cookie. The
  consent question from the A/B post applies here too.
