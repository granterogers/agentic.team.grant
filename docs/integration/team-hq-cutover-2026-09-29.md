# Team HQ canonical cutover — 29 September 2026 (#382)

The brief is in `docs/spec/team-hq-canonical-cutover-2026-09-29.md` (verbatim)
and the decision in ADR-0051.

## Root cause

`goToPath` chose the renderer from the address prefix:
`state.experience = bits[0] === 'basecamp' ? 'basecamp' : 'default'`. So the
root, every plain link, a sign-in return (the link comes back to the address
it was requested from) and every older-studio link rendered the older studio,
and the newer workspace existed only under `/basecamp`. Jump also offered a
result, "Current Team HQ", that left Team HQ for the older studio.

## Routing

| Entry point | Before | After |
|---|---|---|
| `/` | older studio portfolio | **Team HQ portfolio** |
| sign-in return (`back` = the page's own address) | older studio at `/` | **Team HQ at `/`** |
| `/p/<slug>`, `/p/<slug>/<tab>` | older studio project | **Team HQ workspace / tool** |
| `/tasks`, `/activity` | older studio views | **Team HQ My Tasks, Activity** |
| `/basecamp`, `/basecamp/…` | Team HQ | **redirect (replaceState) to the same address without the prefix** |
| `/studio/` | static copy of the older studio | **Team HQ at `/`** |
| `/studio/p/…` | **404** (excluded from the rewrite) | **Team HQ equivalent** |
| `/p/<slug>/overview` (older studio) | older studio overview | **Team HQ project, `/p/<slug>`** |
| `/p/<gone>/…` | portfolio | portfolio, after the real list has been tried |
| Team HQ links, cards, Jump, miniatures | `/basecamp/…` | **canonical** |
| Jump "Current Team HQ" | older studio | **removed** |
| older studio | the default | **`/classic`, unlinked** |
| Telegram / Slack / email | only the site root (`web.base_url`); no project links | unchanged; the root is Team HQ now |

## Found by the production acceptance, and fixed

- **A refresh before the office answered lost the project.** A deep link to a
  real project resolves only once the office's projects arrive. Until then the
  page shows the portfolio, and it used to write `/` into the address during
  that wait. Measured live, the wait was up to five seconds, and 3 of 8 cold
  phone opens refreshed inside it.
  - Fixed in `77fc323c`: the arrival address is kept until it has been tried.
  - `verify:team-hq-journey` §6 covers it, and removing the guard turns 4 of
    its checks red.
- **The dock's heading and replies inherited Team HQ's light text.** Under the
  light scheme that was about 1.1:1 on the dock's light surface. The dock now
  sets its own ink.

## Deployment

| | |
|---|---|
| Page before | `dpl_AnQWPdpGsF4vqvr1jL5ZFuGJ4rqj` (`d77285f0`) — **rollback point** |
| Cutover | `dpl_DKNfivsubn2WGokCY9sbU7WhRCft` (`9e2431a0`) |
| Final | **`dpl_CojPMBWNXjWfQ3ogNAmXx6ZyAB9e`** (`77fc323c`) |
| Method | production's own file tree reused by digest; only changed entries uploaded. The first deploy changed 17 entries (8 web files at `/` and `/studio/`, plus `vercel.json`); the second changed 2 (`app.js` at both locations) |
| Not touched | worker, voice, `hq-api` and every other function; migrations; secrets; SSO; env vars; project settings |

## Production acceptance (live, signed in, read-only)

Every write was aborted in the browser. The one Chat turn was captured and
aborted before it left the browser, and nothing reached Telegram, Slack or the
office.

| # | Check | Desktop | Phone |
|---|---|---|---|
| 1–2 | `/` opens Team HQ, not the older studio | ✔ | ✔ |
| 3 | projects display (4) | ✔ | ✔ |
| 4 | a project opens the Team HQ workspace | ✔ | ✔ |
| 5 | switching projects and tools stays in Team HQ | ✔ | ✔ |
| 6 | project Chat opens | ✔ | ✔ |
| 7 | a Chat turn states the project's id; the dock stays pinned across navigation | ✔ | ✔ |
| 8 | `/basecamp`, `/basecamp/p/…`, `/studio/`, `/studio/p/…`, `/p/…/overview` resolve | ✔ | ✔ |
| 9 | a refresh 0.5 s after opening a project keeps it, 3 of 3 | ✔ | ✔ |
| 10 | phone route | — | ✔ |
| 11 | no visible "Basecamp", no link to `/classic`, title "Team HQ — Agentic Team" | ✔ | ✔ |
| 12 | no console or page errors from the product | ✔ on clean loads | ✔ on clean loads |

**Item 12 and the sandbox proxy.** Occasionally a stylesheet was refused as
`text/plain`, or a script arrived as a 502, and the page could not start.
These are the build session's outbound proxy, not the site:
- the failing responses carry **no `x-vercel-id` and no `server` header**,
  which every Vercel response has;
- their bodies are the real file contents;
- 2 of 120 curl fetches of the stylesheets returned 200 with no content type
  and no `x-vercel-id`, while the other 118 were `text/css` from Vercel;
- 152 of 152 in-browser stylesheet responses over 20 later loads were
  `text/css` from Vercel, with no refusal.

Classification: **environment / provider failure**, and it is recorded in
CLAUDE.md so it is not mistaken for a product defect.
