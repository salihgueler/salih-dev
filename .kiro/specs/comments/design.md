# Comments behind a feature flag

Status: in progress on `feat/comments` (stacked on `feat/reader-counts`, PR #11).

## What readers see

Under a blog post: the approved comments, oldest first, then a form with an
optional name and a comment. After sending, the form says the comment shows up
once Salih has read it. Nothing a visitor sends is shown before approval.

- Name is optional (max 40 characters) and falls back to "Anonymous".
- Comment: 1 to 2000 characters, at most two links, paragraph breaks kept.
- Comments are inserted as text (`textContent`), never as HTML.
- If the API fails, the section stays hidden.

## Flag

`comments` in the `render-flags` profile, next to `renderFromBackend` and
`readerCounts`. Starts off. The page reads it on request-time renders of a post
page (so, like the counter, it needs `renderFromBackend` on for the visitor), and
the comments API reads it again and answers 404 when it's off. Each feature has
its own flag, so the counter and comments can roll out to different audiences
and roll back separately. One flag deployment can turn on both.

Moderation is not behind the flag: turning comments off for readers must not
stop Salih from cleaning up.

## Public API

`/api/comments/<slug>` through CloudFront to a Function URL behind OAC (same
origin request policy as the readers API: the `vid` cookie and
`x-amz-content-sha256`, nothing cached).

- `GET`: `{"comments": [{id, name, body, createdAt}]}`, approved only.
- `POST {"name"?, "body", "website"?}`: `202 {"status":"pending"}`.
  - `website` is a hidden honeypot. When it's filled, the API answers 202 and
    stores nothing.
  - 3 comments per visitor per hour (`429` after that), counted by a hash of
    the `vid`.
  - A new comment publishes to the `CommentsTopic` SNS topic ("a comment is
    waiting"). A failed publish doesn't fail the submission.
- No `vid` is 400, an unknown post 404, the flag off 404.

## Moderation API

On the existing IAM content API, editor principal only (`CONTENT_ALLOWED_CALLER_ARNS`):

| Route | Does |
|---|---|
| `GET /v1/comments/pending` | list waiting comments (all posts) |
| `POST /v1/comments/pending/{commentId}/approval` | approve |
| `DELETE /v1/comments/pending/{commentId}` | reject |
| `DELETE /v1/comments/{slug}/{commentId}` | remove an approved comment |

## Storage

`Comments` table (state stack, on-demand, retained, point-in-time recovery, TTL
on `expiresAt`).

| pk | sk | holds | expires |
|---|---|---|---|
| `pending` | `<id>` | slug, name, body, createdAt, visitor hash | 30 days |
| `post#<slug>` | `c#<id>` | name, body, createdAt | never |
| `rate#<hash>` | `hour#<YYYYMMDDHH>` | count | 2 hours |

- `id` is a UTC timestamp plus random hex, so both partitions sort by time.
- Approval is one transaction: delete the pending item (conditional), put the
  approved one. The approved item doesn't carry the visitor hash.
- The `vid` itself is never stored. IP addresses are never stored.
- The public function can `PutItem`, `UpdateItem` and `Query`. Only the
  moderation function can `GetItem` and `DeleteItem`, so the public API can't
  approve or delete anything.

## Rollback

A fifth AppConfig monitor, `CommentsErrorsAlarm`: two or more failures in a
minute (the function's `Errors` plus handled `store_error` lines). Five is the
AppConfig maximum per environment, so a sixth flagged feature has to share an
alarm.

## Privacy

A short notice under the form says comments are read before publishing and
that the name and comment are shown publicly. The site has no privacy page yet;
that, and how a commenter asks for removal, is Salih's call (GDPR).
