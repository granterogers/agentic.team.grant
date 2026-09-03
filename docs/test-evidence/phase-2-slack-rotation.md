# Phase 2 evidence — Slack config-token rotation

**Date:** 2026-09-03 · **Reproduce:** `npm run slack:rotate -- --status`
**Scheduled:** `.github/workflows/slack-rotation.yml`, every 4 hours

§15: the config token pair expires roughly every twelve hours, so *everything*
Slack depends on a credential that turns over twice a day. This is why
`docs/implementation-plan.md` front-loads it into Phase 2 rather than
discovering it in Phase 7.

## The starting state was already broken, which is the normal state

```
POST apps.manifest.export with SLACK_APP_CONFIG_TOKEN (issued 2026-09-02)
  -> ok: false, error: token_expired
```

A twelve-hour credential handed over yesterday does not work today. That is not
a fault to fix, it is the reason rotation cannot be a manual step.

## Rotation recovers from expiry

```
refresh token source: vault (len 158, fp a4197fb8)
recorded expiry: none — never rotated through this path
current refresh token persisted before rotating
rotated and persisted: access len 183 fp c3d2c97c, refresh len 158 fp b7a28457
new expiry: 2026-09-04T00:28:16.000Z (12h away)
verified: apps.manifest.export ok, app "AI Team HQ"
```

**The refresh token outlives the access token**, so an expired access token is
recoverable without a human. That is the load-bearing fact, and it was not
assumed.

## …and across machines, which is the "survives a restart" half

The acceptance criterion asks for rotation surviving a restart. Run on a GitHub
runner — a different machine sharing nothing with this session but the database:

```
refresh token source: vault (len 158, fp b7a28457)   <- written by the session above
recorded expiry: 2026-09-04T00:28:16.000Z (43036s away)
current refresh token persisted before rotating
rotated and persisted: access len 183 fp 2e854757, refresh len 158 fp 69c76ad5
new expiry: 2026-09-04T00:31:06.000Z (12h away)
verified: apps.manifest.export ok, app "AI Team HQ"
```

The fingerprint chain is the proof: `a4197fb8 → b7a28457` in this session,
`b7a28457 → 69c76ad5` on the runner. Rotating state moved between machines
through Postgres alone, which is §15's *"its rotating state belongs in the
database"* doing exactly what it is for.

The full twelve-hour window is satisfied by elapsed time rather than asserted:
the schedule runs every four hours, not twelve, because a twelve-hour credential
rotated on a twelve-hour schedule has zero margin and the first missed run is an
outage. At four hours, two consecutive runs can fail and it still rotates in
time. Evidence accrues.

## The safety ordering, tested by accident

The refresh token is **single-use**, so the order is the design:

1. persist what we have · 2. rotate · 3. persist the new pair · 4. **then** verify

A first attempt crashed at step 3½ — on the database bookkeeping write, after
rotating and after persisting. **Nothing was lost:** the next run read the new
refresh token straight out of the vault and continued, which is why the source
line above reads `vault` rather than `bootstrap environment` on what was
nominally a first run.

Had the order been rotate → record → persist, that crash would have destroyed
Slack config access permanently, recoverable only by a human regenerating the
pair. Verifying before persisting is the natural order and is the wrong one.

## The gap that crash exposed

The crash surfaced as an unrelated-looking error:

```
23503: slack_app_credentials.bot_token_ref references vault secret
       08d4f4c7-… which does not exist
```

An earlier verification script had deleted a vault secret, and the row
referencing it became dangling **with no write to it at all**. 0007's trigger
validates references on write, so it could not see this — and worse, it then
blocked the very write that would have fixed the bad reference, because it
validates every reference on the row.

A foreign key into `vault.secrets` would prevent it, and 0007 deliberately
rejected that to avoid coupling to a Supabase-internal table. **That trade
stands.** What was missing is the other half of it — §8's reconciliation:
*"webhooks and push events are hints, not truth."* A reference is a hint that a
credential exists, and hints get reconciled.

Migration 0010 adds `credential_health`, `credential_health_problems` and
`slack_rotation_health`. Detection rather than prevention, which is the honest
consequence of choosing not to couple:

```
  bot_token_ref          not_configured
  client_secret_ref      not_configured
  config_refresh_ref     ok
  config_token_ref       ok
  signing_secret_ref     not_configured

rotation: status=ok expires_in=43062s failures=0
```
