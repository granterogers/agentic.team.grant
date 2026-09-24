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

## F-002 — Twenty migrations assert the CONTENTS of Grant's database, not its schema

**Status:** SCAFFOLDED — zero-state is GREEN at 607/607 · **Journey:** C, J · **Severity:** blocks zero-state; cannot be fixed in place

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

The corpus grew to 607 while this workstream ran, and the class grew with it.
Eleven more appeared between 0539 and 0591, every one the same shape — a drive
block that is right to refuse to claim it proved anything:

| Migration | What it requires of the DATA |
|---|---|
| `0539` | a lesson the harness authored, for `p_include_harness` to widen over |
| `0545` | a lesson **he** authored, so the filter does not leave nothing |
| `0547` | a project that is not the inbox, for the drive's `order by updated_at` |
| `0566` | **two specific delivery uuids** — the two #298 escapes, by id |
| `0571` | the 8 September voice note that died: a failed root turn owed a sentence |
| `0574` | a suite-signed inbound command, so the widened predicate has a subject |
| `0582` | a suite that labelled itself in a voice key's **third** segment |
| `0583` | escaped deliveries to acknowledge — *"known escapes fell to 0"* |
| `0584` | a `google.read_mail` job, to drive `say_once` against |
| `0585` | two `drive.watch` jobs on **different** projects |
| `0586` | one activity-panel entry that is not suite traffic |
| `0589` | an `office.slack_rotate` job |
| `0590` | a **connected** Slack and Telegram in `connection_health` |
| `0591` | a `notebook.generate` job to drive the approval round-trip against |

With all twenty scaffolded: **607/607 applied, 17.8s, from a database dropped
immediately before the run.** Reproduce with
`npm run fresh:zero-state -- --preconditions`.

`0590` is worth separating from the rest. It is not an assumption about Grant's
BUSINESS, it is an assumption about a CONNECTED office — Slack and Telegram
present in `connection_health` — and that distinction decides the remedy: a
fresh install genuinely does not have those rows until somebody connects
something, so the scaffold supplies labels and no credential material, which
the table's own `connection_health_carries_no_credential` constraint enforces.

Nothing scaffolded invents business data. Every row is named as scaffolding in
each column that can carry a name, every job is `cancelled` with a reason
saying it never ran, and the migrations' substantive assertions are all still
decided by the product: 0583 must still FIND its escapes through
`app.harness_job`, 0585's cross-project control still fails if one project
silences another, and 0590's two controls both move rows the precondition
created and require the answer to flip.

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

---

## F-004 — The baseline: what a fresh install actually applies

**Status:** FIXED · **Journey:** B, C, H, I

`migrations/` cannot be the installer (F-002), so `npm run fresh:baseline`
captures the schema after all of them as structure plus product seed, and
`npm run fresh:install` applies it in ONE statement — atomic, so an interruption
leaves the empty database it started with rather than a half-built one.

Four things stood between the baseline and being installable, and every one was
only findable by applying it: `COPY ... FROM stdin` is psql meta-commands a
driver cannot read; pg_dump 16 wraps output in `\restrict`; `CREATE SCHEMA
public` fails on every target that could ever receive it; and the seed carries
`vault.naming`, a row that predates the trigger refusing a config key beginning
with a schema name and so could not be written today.

## F-005 — `providers.secret_ref` is read and nothing sets it

**Status:** FIXED (migration 0536) · **Journey:** B, G
**Severity:** silent. Setup looks complete and the office cannot think.

`ProviderRouter.key()` prefers the vault over the environment and resolves
`providers.secret_ref`. `app.store_secret` writes the vault row and sets no ref.
**Nothing in the repository connected the two.** On this database it never
mattered, because the deployed worker carries `OPENROUTER_API_KEY` in its
environment and the fallback catches it. On a fresh installation it is the whole
difference between an office that thinks and one that cannot — and it fails in
the worst available way: the new person follows the instruction exactly, every
check that looks for the credential finds it, and every job fails for want of a
key in the same database.

§5's list names the shape: *"credential presence mistaken for working
connection."*

Fixed by `app.connect_provider_key(provider, secret_name)` — a function rather
than a line in a setup script, because a capability that exists only as a script
an agent runs is a capability nobody has. The doctor now asks whether the
provider is CONNECTED rather than whether a key exists.

## F-006 — `web/studio` points a fresh dashboard at this project's gateway

**Status:** OTHER_BRANCH (`claude/basecamp-team-hq`) · See INTEGRATION-REQUESTS.md IR-1

## F-007 — The job state machine's transitions are in `app`, and a seed list built from `public` missed them

**Status:** FIXED · **Journey:** C, G

`app.job_transitions_allowed` holds the 46 moves a job may legally make, and
`enforce_job_transition` reads it on every state change. An office installed
without them accepts a message and can never run it: the first
`queued -> running` is refused as an *"illegal job transition"*, which reads
like a bug in the worker. Every other check was green over it, and it was found
by `npm run fresh:first-use` — §22's argument in one incident.

## F-008 — `unnamed` is the inbox, and was excluded as personal data

**Status:** FIXED · **Journey:** C, G

`inbound_commands.project_id` is NOT NULL and defaults to
`app.unnamed_project()`. Without that row a brand-new office refuses the first
instruction anybody sends, with `23502: null value in column "project_id"` —
an error naming a column and not a cause.

## F-009 — 252 files default to this project, and the default must stay

**Status:** MITIGATED · **Journey:** A, J

`process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'` appears in 252
files. For Grant the default is load-bearing: a Claude Code session starts with
no environment and without it not one command would run. Removing it would break
every session on the day it shipped, in the name of somebody who does not exist
yet.

For a second person it is a quiet failure: their own token against a project
that is not theirs, refused, with no sentence saying why.

So the default stays and stops being silent. `resolveProjectRef` returns the
environment variable when set and otherwise returns the default **after saying
once that it did, and what to set**. Used by `scripts/migrate.ts` and
`src/office/pass.ts` — the two that a fresh user actually runs. `npm run
check:fresh` refuses the shape anywhere new.

Rewriting all 252 was considered and rejected: a diff across the whole
repository, while three other workstreams are in flight, for a change whose
whole benefit is a message that `resolveProjectRef` now prints anyway.

---

## F-010 — `fresh:install` silently installed into a throwaway

**Status:** FIXED · **Found by:** the adversarial clean-room pass · **Journey:** B

Following `SETUP.md` in order, a person reaches `npm run fresh:install` before
they have created a Supabase project — because the document lists the project as
step 3 and the install as step 6, and people do not always do things in order.

It defaulted to a local `fresh_alex_*` database, succeeded in a second and a
half, and printed **INSTALLED**. The line above it said "disposable", which is
exactly the kind of word somebody setting a thing up for the first time does not
read. They would have had a working office they were never going to look at
again, and no reason to suspect it.

The local path must now be asked for by name (`FRESH_DB`). A person gets told
what to do instead, with the two exports and a pointer to the doctor.

**Only findable by running it.** Every check was green over this: the install
worked, the database was valid, the acceptance suite passed — because the
acceptance suite sets `FRESH_DB`, which is precisely the thing a person does
not do.

## F-011 — The doctor told somebody to fetch a key they had already stored

**Status:** FIXED · **Found by:** the adversarial clean-room pass · **Journey:** A

Storing the OpenRouter key and re-running the doctor produced:

```
NEXT: An OpenRouter API key
  1. Go to https://openrouter.ai and sign in.
  ...
```

The key was in the vault. What was missing was `npm run fresh:configure` to
connect it — and **the check knew**: its own detail line said *"a key is stored
but nothing is using it yet"*. The next-action block was not reading it, and
showed the entry's usual human steps instead.

A person following that would go and make a second key, and the second one would
not work either, for the same reason. A `Result` may now carry what to do about
THIS state, and the next-action block prefers it.

## F-012 — The doctor could never finish against the one target needing no account

**Status:** FIXED · **Journey:** A

A local harness database has no Supabase project, no access token and nothing
deployed in front of it, and never will. The doctor reported all five as
**todo**, so it counted down to a number it could not reach — and a progress
report that cannot finish is one nobody follows. Those entries now report
`n/a` with the reason, and the count says how many do not apply.

## F-013 — A `pg_proc` scan written as a JOIN calls `pg_get_functiondef` on aggregates

**Status:** SCAFFOLDED (precondition before 0573) · **Journey:** C · **Severity:** blocks zero-state on some plans

Migration `0573` asks its property of the WRITERS rather than of the recorded
rows, which is the good design the file exists to argue for. It asks it like
this:

```sql
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app'
  and pg_get_functiondef(p.oid) ~ 'undo_offer\s*\('
```

`nspname = 'app'` is a qual on the OTHER side of a join, so whether
`pg_get_functiondef` is called on a catalogue row at all is a matter of the
PLAN. On a fresh database the planner drives from `pg_proc`, evaluates the
regex against all 3,300 rows of it, and raises `42809: "array_agg" is an
aggregate function` — an aggregate has no definition to get.

**This is not a data assumption.** It is plan luck, and it is the only
migration in the corpus that scans `pg_proc` through a join: the other twenty
filter `pronamespace` directly, which is a scan-level qual and therefore safe
by construction.

The precondition tells the planner the truth rather than touching the
migration — `alter function pg_catalog.pg_get_functiondef(oid) cost 10000` —
after which `pronamespace` becomes an index condition and the expensive
function is only called on the rows 0573 meant.

**The rule for new work:** filter `pronamespace` on the scan
(`where p.pronamespace = 'app'::regnamespace`), never through a join to
`pg_namespace`. The next one written as a join will do this again on somebody
else's machine.
