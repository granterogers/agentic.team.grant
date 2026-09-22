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
