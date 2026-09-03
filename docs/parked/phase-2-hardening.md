# Parked: Phase 2 hardening items found during Phase 1

Recorded as they were discovered, so none is rediscovered later as a surprise.
**None blocks Phase 1.** Each is a real weakness with a known fix that Phase 1
is not the right place to build.

---

## 1. A least-privilege role for backups — blocked by Supabase, not by design

The nightly `pg_dump` authenticates as `postgres`, which is the owner and can do
anything. A backup job should hold a read-only credential: a leak then cannot
modify the database, and it would close most of the blast-radius concern noted
when the backup credentials moved into the vault.

**Attempted in Phase 1 and reverted.** A role with `pg_read_all_data` is the
right shape, but every table here has `FORCE ROW LEVEL SECURITY` and the backup
role has no policies, so `pg_dump` cannot read anything without `BYPASSRLS` —
and granting `BYPASSRLS` requires superuser, which Supabase does not give to
`postgres`:

```
ERROR: 42501: permission denied to alter role
```

`pg_dump` fails loudly rather than silently producing an empty backup, so this
is not a correctness hazard today — but it does mean the backup credential is
more privileged than it should be.

Three routes, in preference order:

1. A permissive `FOR SELECT TO ai_team_backup USING (true)` policy on every
   RLS-enabled table, plus a **verification check that every such table has
   one** — otherwise a table added later is silently excluded from the dump.
   The check is the important half; a per-table policy scheme without it is the
   fragility that made this a Phase 2 item rather than a Phase 1 one.
2. Ask Supabase support whether `BYPASSRLS` can be granted on this project.
3. Accept dumping as `postgres` and compensate with **B2 Object Lock** (item 2),
   which limits the damage a leaked credential can do to the backups themselves.

## 2. B2 Object Lock on the backup bucket

Currently **disabled**. With the backup credentials in the vault, one credential
(`SUPABASE_ACCESS_TOKEN`) reaches both the live database and the backup store.
The separate GitHub Actions secret store previously gave defence in depth.

That matters more for backups than anywhere else, because deletion of backups is
precisely the thing backups defend against. Object Lock makes a compromised
write key unable to delete or overwrite history at all — which is a stronger
guarantee than credential separation ever was, since it does not depend on the
credential staying secret.

Requires a bucket setting and a retention period decision. Interacts with the
30-day pruning in `backup.yml`: a retention lock longer than the prune window
would make pruning fail, so the two numbers must be chosen together.

## 3. `SUPABASE_DB_URL` in the environment is stale

The database password was reset on 2026-09-03 (`npm run bootstrap:db-password`)
because the supplied one failed authentication. The new value lives only in the
vault. The environment variable still holds the old password.

Harmless — nothing reads it — but it should be removed or updated so it does not
mislead someone later. The value that *would* be useful there is a **Session
pooler** URI for the deployed runtime, which is a Phase 2 concern anyway.

## 4. `ai_team_app` has no password yet

Created `NOLOGIN` in migration 0001 deliberately: a role with no password has no
credential to leak, and enforcement is testable via `SET LOCAL ROLE`. Phase 2
gives it a password, stored in the vault, and points the deployed runtime at it
so the application stops connecting as an owner-privileged role.

## 5. Slack config-token rotation is untested against a real expiry window

`slack_app_credentials` carries the rotation state (migration 0007), but nothing
rotates yet. `docs/implementation-plan.md` already front-loads this into Phase 2
for the right reason: everything Slack depends on a credential that turns over
roughly twice a day, so it must be observed rotating across a genuine 12-hour
expiry **and** a restart before anything is built on top of it.

## 6. The Telegram Edge Function writes as `service_role`

`service_role` has `BYPASSRLS`, so the webhook currently writes to
`inbound_commands` with more privilege than it needs. §15 names it the
highest-blast-radius credential in the system.

Not urgent, because the blast radius is bounded by the endpoint itself: it can
only insert one shape of row, and only after passing constant-time secret
verification. But it is more than the job requires.

The fix comes with item 4 — once `ai_team_app` has a password in the vault, the
function connects as that role instead and RLS applies. Recorded now so it is
not discovered later as a surprise.

## 7. The voice POC endpoints are unauthenticated

`voice` and `voice-token` are deployed with `verify_jwt: false`, because Grant
opens the page in Safari with no Supabase session. Anyone with the URL can mint
a Realtime credential and spend money.

Bounded for now: the URL is unadvertised, the ephemeral credential expires in
about a minute, and the OpenRouter-style spend guards do not apply here because
Realtime has no free tier — which is exactly why D3 is a funding decision.

Not acceptable past the POC. Options, in preference order:

1. A short-lived signed link — Grant opens a URL carrying an HMAC over an
   expiry, verified by the function. No session needed, nothing to log in to,
   and a leaked link stops working.
2. A shared secret in a header, which means a bookmark cannot carry it.
3. Supabase auth with a real session, which is the right answer once Team HQ
   exists and Grant is logged into it anyway.

Whichever is chosen, the mint endpoint also wants a per-hour cap, so a leaked
URL costs a bounded amount rather than an unbounded one.
