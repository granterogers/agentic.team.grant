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

---

## IR-2 · Migration numbers 0534–0536 are claimed by three branches at once

**Owner:** whoever merges · **Raised by:** the final reconciliation
**Not a defect.** Four workstreams adding migrations in parallel cannot avoid it.

### The collision, exactly

| Number | `claude/fresh-install-onboarding` | `claude/human-simulation-harness` | `claude/production-reliability` |
|---|---|---|---|
| 0534 | the MCP address is this office's or it is nothing | the harness can ask to see its own projects | — |
| 0535 | a column comment that names a bot nobody else has | a job that dies says so wherever it died | a job that dies says so wherever it died |
| 0536 | an office can connect its own thinking | a resumption is not a retry | a resumption is not a retry |

`claude/human-simulation-harness` reaches 0548 and `claude/production-reliability`
0544. Both also carry **two files numbered 0543** between them, which is the
same collision one branch further along.

### Why it cannot be avoided by renumbering now

`checkMigrations` refuses a GAP in the sequence as well as a duplicate — and it
is right to, because a gap is how a missing migration announces itself. So
nobody can reserve a block by numbering into the distance; whoever merges
second must renumber, whatever anybody does today. Picking 0549–0551 now would
be a guess about how far the other branches get before they land, and a wrong
guess costs the same work plus the confusion of a number that moved twice.

**So these three are deliberately left at 0534–0536.**

### Renumbering them is mechanical

They are independent of each other and of everything else: none references
another by number, none is referenced by name anywhere in `src/`, and each
drives itself so a renumbered copy proves itself on the next zero-state run.

```bash
git mv migrations/0534_the_mcp_address_is_this_offices_or_it_is_nothing.sql \
       migrations/<n>_the_mcp_address_is_this_offices_or_it_is_nothing.sql
# …the other two…
npm run fresh:baseline    # REQUIRED — see below
npm run check:fresh
npm run fresh:accept
```

### The part that is easy to miss

`migrations/baseline/baseline.json` lists every migration by name, because the
baseline records exactly which ones it stands in for. **Any migration added or
renamed by any branch leaves it stale**, and a stale baseline means a fresh
install arrives missing the difference — silently, because the office looks
complete.

`npm run check:fresh` catches it. Proved by adding a migration and watching it
say:

```
[baseline-is-behind] migrations/baseline/baseline.json
    the baseline represents 536 migrations and there are 537. A fresh install
    would arrive missing the difference. Run: npm run fresh:baseline
```

**So: after merging any branch that adds a migration, run
`npm run fresh:baseline` and commit the result.** It takes about twenty
seconds and it is the one step that keeps a fresh install honest.
