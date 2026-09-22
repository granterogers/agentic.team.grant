# INTEGRATION REQUESTS TO PARALLEL WORKSTREAMS

Changes the fresh-install path needs that this branch does NOT own. Each names
the owning branch, the exact requirement, and why a fresh install needs it. This
branch does not make these changes; it records them precisely enough that the
owning branch can, without this conversation.

---

## IR-1 · `web/studio` points a fresh user's dashboard at this project's gateway

**Owner:** `claude/basecamp-team-hq` · **Raised by:** `npm run check:fresh`
**Severity:** a second person's dashboard talks to somebody else's office.

### What is there

Five files in `web/studio` compose the gateway address the same way:

```js
window.HQ_API || 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'
```

`app.js:13005` · `call.js:37` · `chat.js:228` · `office.js:32`, and
`data.js:22` does the same for the avatar store:

```js
const FACES = 'https://baujwlzcziasnfhhkchg.supabase.co/storage/v1/object/public/avatars'
```

### Why it matters on a fresh install

A new person deploys the dashboard and, unless something sets `window.HQ_API`,
every request it makes goes to the development project's gateway rather than to
their own office. Their bearer token is refused there, so nothing is damaged —
what they get is a dashboard that loads, looks right, and answers nothing, with
no sentence anywhere saying why. That is the failure shape this workstream keeps
finding: not a crash, a plausible-looking wrong thing.

The avatar base is milder and more visible: a fresh office's staff photographs
are served from a bucket that belongs to someone else, and will stop working the
day that bucket changes.

### What would fix it

The office already knows its own address. `system_config.db.project_ref` holds
it, `npm run fresh:configure` sets it, and `app.hq_mcp()` composes a URL from it
(0534). Two possibilities, and the second is better:

1. Have `npm run deploy:page` write `window.HQ_API` into the deployed page from
   the project being deployed to, so the fallback is never reached.
2. Better: have the page ask. A single unauthenticated section on the gateway
   that returns the office's own base URLs would mean the page holds no
   address at all — but that is circular for the FIRST request, so it needs (1)
   for the gateway itself and can use it for everything else, the avatar base
   included.

**This branch has not touched any of it.** `npm run check:fresh` reports these
five files every run, as findings owned elsewhere, and does not fail on them —
a gate this branch cannot make pass is a gate somebody switches off, and a
silent skip would leave the next person no way to know the rule had stopped
applying there.

### What this branch did instead

`src/fresh/project-ref.ts` exists for the same problem on the Node side, and
`0534` fixed the one live database function that had it. The pattern to follow
is 0534's: **there is no better default than none.** The address of an office is
a fact about that office, there is nothing to guess it from, and a well-formed
URL pointing at somebody else's project is worse than no URL at all.
