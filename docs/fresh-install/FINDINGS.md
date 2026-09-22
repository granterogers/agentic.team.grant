# FRESH INSTALL — FINDINGS LEDGER

Every defect, friction point and Grant-specific assumption found on the
new-user path. Newest section at the bottom. Each entry states the EVIDENCE,
not just the claim — CLAUDE.md: *"A comment claiming a property is worth
nothing without a check behind it."*

Status vocabulary: `OPEN` · `FIXED` · `HUMAN_BLOCKED` · `NOT_A_DEFECT` ·
`OTHER_BRANCH` (owned by a parallel workstream).

---
## F-001 — The migration corpus cannot reach a blank database. It stops at 0054 of 533.

**Status:** OPEN · **Journey:** C (zero-state), J (no Grant contamination)
**Severity:** this is the single blocking defect of the whole fresh-install path.

### Evidence

`npm run fresh:zero-state` against a genuinely blank local Postgres 16, through
the **real** `runMigrations` runner (not a psql loop):

```
zero-state target: fresh_alex_zero_state (local, disposable)
blank database created and the Supabase shim applied
app.schema_migrations records 53 migration(s)

FAILED at 0054_staff_have_their_own_bots.sql
0054 ... failed and was rolled back: 23514: new row for relation
"telegram_bots" violates check constraint "telegram_bots_enabled_needs_a_token"

RESULT: ZERO-STATE FAIL (53/533 migrations recorded, 0 applied this run)
```

### Cause

0054 seeds Grant's own Telegram bots as literal rows:

```sql
insert into public.telegram_bots (staff_slug, bot_id, username, token_ref, is_pager)
values (null, '8967954396', 'atg_chief_bot',
        (select id from vault.secrets where name = 'telegram.chief.bot_token'), true)
```

On Grant's database that subselect found a row, because he had stored the token
by hand days earlier. On a blank database it is `null`, `enabled` defaults to
`true`, and the table's own constraint — *"A bot with no token cannot send.
Saying it is enabled would be a claim the system cannot honour"* — correctly
refuses the row.

**The constraint is right. The seed is what is wrong.** It is Grant's
installation state written into the schema's history as though it were part of
the schema.

### Why it is a class and not an instance

CLAUDE.md: *"Ask whether the thing that failed is an instance or a class before
patching the instance."* A replay with placeholder vault rows gets past 0054 and
then fails 76 more times, and the distinct roots are not all cascades:

| Root | Kind |
|---|---|
| `0054` telegram_bots seed | Grant's resources as seed data |
| `0167` *"voice_state knows of no projects, so a call would know nothing"* | a migration that RAISES unless Grant's projects exist |
| `0169` *"nothing was adopted as a mirror: 0 documents, 0 originals"* | a migration that RAISES unless Grant's documents exist |
| `0508`-ish *"CONTROL FAILED: a task from two hours ago answered 'that'"* | a migration running a behavioural control against Grant's data |

So the class is: **migrations that assert the presence of Grant's operational
data, in a corpus that is also the only installer a new user has.**

### What must NOT be done about it

`migrations/` is append-only and checksum-enforced (`npm run check:migrations`,
and CLAUDE.md: *"An applied migration is immutable and `check:migrations`
enforces it"*). Editing 0054 would break Grant's production ledger and the
integrity check. **The fix must be forward-only.**

---

## F-002 — Nine migrations assert the CONTENTS of Grant's database, not its schema

**Status:** OPEN · **Journey:** C, J · **Severity:** blocks zero-state; cannot be fixed in place

### Evidence

Replaying the corpus into a blank database, each failure fixed in turn, the run
stopped nine times at a migration that required Grant's operational data:

| Migration | What it requires of the DATA | Reached |
|---|---|---|
| `0054` | Grant's seven Telegram bots, and a stored token for the chief's | 53/533 |
| `0167` | a project named **"Legacy Coaching Course"**, holding material | 166 |
| `0169` | a Notion mirror to adopt — *"nothing was adopted as a mirror"* | 168 |
| `0489` | any job at all, to attribute a proposal to | 488 |
| `0490` | a job that is **not** harness traffic, as the control | 489 |
| `0498` | at least one `slide_deck` **and** one `mind_map` artifact | 497 |
| `0516` | that no other personal task was created in the last hour (see F-003) | 515 |
| `0523` | that Grant's real chat `1386648496` has **received real deliveries** | 522 |
| `0524` | **at least 100** harness deliveries that escaped before the guard existed | 523 |

With all nine scaffolded: **533/533 applied, 14.6s.** Reproduce with
`npm run fresh:zero-state -- --preconditions`.

### The finding, stated precisely

These are not careless migrations. Every one of the assertions is defensible —
several are exemplary, and `0523`'s is the best of them: it refuses to decide
whether a destination is real by checking an identity, and asks the delivery
rows instead. `0167`'s comment says why it exists: *"a function that returns
valid JSON with nothing in it looks identical to a working one from every angle
except his."*

The defect is not in any migration. It is that **`migrations/` is simultaneously
two things**: the append-only record of how Grant's database became what it is,
and the only installer a new user has. As a record it is excellent. As an
installer it cannot work, because nine of its steps assert facts that only
accrue by running the system for months. `0524` is the proof of that in one
line: no credential, account or configuration produces a hundred historical
mistakes.

### Why the fix cannot be in `migrations/`

Applied migrations are immutable and checksum-enforced. Every repair must be
forward-only, and a forward-only migration cannot help a run that dies at 0054.

### The fix

Separate the two roles. `migrations/` stays exactly as it is. A fresh install
gets a **baseline**: the schema as it stands after all 533, captured as
structure with no data, applied in one step and recorded as all 533 applied. See
F-004 and `npm run fresh:baseline`.

---

## F-003 — A migration control that depends on time passing fails in any replay

**Status:** FIXED (in the harness) · **Journey:** C · **Severity:** low, but it will recur

`0516`'s control asserts a task from two hours ago is not what *"that"* means. It
deletes its own probes, back-dates one, and requires `app.my_task_recent()` to
answer null. On Grant's database every other personal task was days old. In a
replay the whole corpus applies in minutes, so a task created by an earlier
migration is seconds old and legitimately IS the most recent — and the control
fails naming a task about a function that works:

```
CONTROL FAILED: a task from two hours ago answered "that"
  — Reconnect google_calendar — oauth_client
```

A user who applied the migrations one at a time over months would never see
this; one who applies them in an afternoon always would. The harness restores
the elapsed time rather than deleting the awkward rows — deleting would also
pass, and would be the harness quietly removing the evidence against its own
assertion.
