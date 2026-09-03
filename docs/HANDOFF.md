# Session handoff — 2026-09-03

**For:** the next Claude Code session · **Branch:** `claude/new-session-o2oklu`

Phase 0 is complete and **Phase 1 is unblocked**. This session verified
credentials only; it deliberately wrote no Phase 1 code, because the stop
condition in its brief said to halt if the database was unreachable — and it was,
for reasons that turned out to be more fundamental than a bad connection string.
That is now solved. Read this, then start Phase 1.

---

## Read in this order

1. `AI_TEAM_HQ_MASTER_SPEC.md` — canonical. Supersedes everything else.
2. `docs/adr/` — **seven** ADRs. Do not re-litigate them; ADR-0007 is new and
   load-bearing for how you talk to the database at all.
3. `docs/design/core-invariants.md` — the provider-independent core.
4. `docs/implementation-plan.md` — Phase 1 scope and acceptance criteria.
5. `docs/test-evidence/2026-09-03-credential-verification.md` — what is actually
   proven to work, with the exact calls.

---

## Three things that will waste your time if you don't know them

### 1. You cannot reach Postgres. Do not try.

All non-443 outbound TCP is blocked in this environment. Ports 5432 and 6543
time out; 443 to the same host connects. The direct database host is IPv6-only
and the container has **no IPv6 address family at all** (`OSError 97`). The
egress proxy's own documentation lists `raw-TCP databases` as unsupported.

`psql` fails with a **bare, empty error message** (`psql: error:` and nothing
else), which is why this is not self-diagnosing. If you find yourself debugging
a connection string, stop and read ADR-0007.

**Use `scripts/db-query.sh` instead.** It runs SQL through the Supabase
Management API over HTTPS and is verified working:

```bash
scripts/db-query.sh "select current_user;"
scripts/db-query.sh --file migrations/0001_whatever.sql
```

`pg_dump` and `psql` have no HTTPS mode, so anything needing the wire protocol —
the nightly backup and the restore rehearsal — runs in **GitHub Actions**, where
egress is unrestricted. That is ADR-0007's second half.

### 2. Environment variables *do* reach a running session. Re-read before concluding one is absent.

This session's first run asserted the opposite and told Grant a restart was
required. It was wrong: `SUPABASE_ACCESS_TOKEN` and four Slack values were added
mid-session and appeared in the **running** container without a restart. The
previous session was restarted on that same false belief.

Propagation is not instant and not guaranteed — the `BACKUP_S3_*` variables had
still not arrived when this session ended. So: **re-read `os.environ` before
reporting a credential missing**, and don't ask for a restart until you have.

### 3. Run the secret scan before every commit

```bash
python3 scripts/secret-scan.py
```

It checks tracked files for every environment value verbatim *and* for known
credential shapes. Public identifiers (Slack client/app id, the S3 endpoint,
region and bucket) are allowlisted; real secrets are not. It is currently clean.

---

## Credential state

| Credential | State |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | ✅ **DDL proven** — create, insert, select, revoke, RLS, policy, drop |
| `SLACK_BOT_TOKEN` | ✅ works, app installed, 17/17 scopes |
| `SLACK_SIGNING_SECRET` | ✅ present, 32 hex — functional test needs Phase 2's endpoint |
| `SLACK_CLIENT_SECRET` / `_CLIENT_ID` / `_APP_ID` | ✅ present and correctly shaped |
| `OPENROUTER_API_KEY` | ✅ `is_free_tier: false`, `limit: 5` ⚠️ **lifetime** cap, not monthly |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `TELEGRAM_CHIEF_BOT_TOKEN` | ✅ verified earlier |
| `SUPABASE_DB_URL` | ⚠️ set, unusable here by design — it is for Vercel, and it is the *Direct* string where Vercel wants the *Session pooler* one |
| `BACKUP_S3_*` (5 vars) | ⬜ **outstanding** — see below |
| `SLACK_APP_TOKEN` | ⬜ empty, **correctly** — Socket Mode is rejected (§4) |

### The one outstanding item

Grant chose **Backblaze B2** (no card required, unlike R2 — the reasoning is in
`docs/credential-shopping-list.md` and it matters, because he removed the
OpenRouter card deliberately). The bucket exists:

```
bucket      ai-team-hq-backups
endpoint    s3.eu-central-003.backblazeb2.com
region      eu-central-003     (B2 shows no region field — it is inside the endpoint)
private · encrypted · object lock disabled
```

Still needed: the Application Key pair, as `BACKUP_S3_ACCESS_KEY_ID` and
`BACKUP_S3_SECRET_ACCESS_KEY` (B2 calls them *keyID* and *applicationKey*).
**Check the environment first** — they may have landed since.

This blocks *finishing* Phase 1, not starting it. And note: **retention is
unconfigured on a 10 GB free tier.** The bucket defaults to "keep all versions";
since the job writes a uniquely-keyed object per night rather than overwriting,
accumulation — not versioning — is the exposure. A lifecycle rule plus pruning in
the job is part of the backup deliverable, or backups fill the bucket and start
failing quietly.

---

## Parked, at Grant's request — do not start these

| What | Where |
|---|---|
| **Obsidian vault sync** — `granterogers/obsidian-vault`, for syncing outputs "later" | [`docs/parked/obsidian-vault-sync.md`](parked/obsidian-vault-sync.md) |

Parked means recorded, not scheduled. Read the note before touching it: there is
a real architectural question in it (delivery surface vs. second knowledge
adapter) and it connects to Gate 2's stop condition.

## Where to start

`docs/implementation-plan.md` is authoritative on scope. The ordering constraint
worth restating, because it is easy to get backwards:

> **CI before schema.** A test harness added after the schema is a harness
> shaped by the schema. Lint, typecheck, test and a migration check must be green
> on an empty suite *first*.

Then, per Phase 1: migrations as versioned SQL under `migrations/`, `events`
append-only enforced by `REVOKE` (proven to hold — a forbidden `UPDATE` returns
`42501`), RLS throughout, the job engine with the full §6 state machine,
idempotency keys from semantic inputs, `SELECT … FOR UPDATE SKIP LOCKED`
dequeue, capacity limits enforced **at dequeue**, database-backed per-provider
circuit breakers, the boot recovery sweep, and undo as a compensating event
keyed on the original `event_id`.

Nothing beyond that. No channels, no agents, no UI past what proves the core
works. Phase 1 closes only when its acceptance criteria are **demonstrated** —
a job surviving a hard kill in each state, and a real backup restored into a
fresh database.

One precedent worth copying: the credential brief asked for
create/insert/select/drop to prove DDL. That proves DDL *runs*. It does not
prove the property Phase 1 depends on — that `REVOKE` is **enforced** rather than
merely accepted — so this session additionally impersonated the application role
and confirmed Postgres refuses the write. Prefer that shape of test throughout:
**assert the property, not the syntax.**

---

## Known-good facts, so you don't re-derive them

- Postgres **17.6**; Management API runs as `postgres` on database `postgres`.
- Project ref `baujwlzcziasnfhhkchg`; Slack app `A0BUFRVSSLD`; workspace
  `T0BUCJ2L5FD`; bot `ai_team_hq` / `U0BUG0RPZ8B`.
- Management API returns **`201`** on success, `400` with a Postgres `SQLSTATE`
  in the message on failure. `[]` is a successful statement returning no rows.
- Another session pushed `docs/credential-shopping-list.md` to this branch
  concurrently. Expect company; fetch before you push.
