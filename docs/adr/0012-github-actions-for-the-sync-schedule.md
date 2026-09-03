# ADR-0012 — GitHub Actions cron for the ten-minute sync

**Status:** accepted · **Date:** 2026-09-03

**Narrows** `docs/implementation-plan.md` Phase 4's *"10-minute sync via
Cloudflare Cron"*.

## Context

Phase 4 specifies a ten-minute discovery and sync cycle and names Cloudflare
Cron as the scheduler. Cloudflare is not configured: there is no
`CLOUDFLARE_API_TOKEN` and no account id in the environment, and Grant has
asked not to be sent after further credentials.

The master spec does **not** mandate Cloudflare for this. §4 lists
*"Vercel Hobby (or Cloudflare Workers)"* for App + API, and names **GitHub
Actions** for the nightly backup. ADR-0002 already enumerated the scheduling
options as *"Cloudflare Workers Cron (primary), GitHub Actions or Supabase"*.
So this is a choice among sanctioned alternatives, not a departure.

## Decision

Schedule the sync with **GitHub Actions cron**, in
`.github/workflows/sync.yml`.

## Why

**It adds nothing.** Actions cron already runs the nightly backup and the
four-hourly Slack token rotation in this repository. Cloudflare would be a
third provider, a fourth credential, and another free tier to document and
monitor — for a capability two existing workflows demonstrate.

This is the same reasoning as ADR-0010, which put the webhooks on Supabase
Edge Functions rather than Cloudflare Workers, and ADR-0011, which put the
voice page on Vercel. Each time the question was "does this need a new
provider?" and each time it did not.

**The interval tolerates it.** Actions cron is best-effort and can be delayed
under load — sometimes by several minutes. That is a real weakness and it does
not matter here:

- the sync is idempotent (proven: a second run creates nothing and adds
  nothing), so a delayed tick is not a lost tick
- a skipped tick is picked up by the next one
- two overlapping runs collide at `sync_runs_one_at_a_time`, a partial unique
  index, rather than racing

Ten minutes is a freshness target, not a deadline. If a future requirement
needs a guaranteed cadence — sub-minute, or a hard SLA — this decision should
be revisited rather than stretched.

**Actions gives things Workers would not.** The run appears in the same place
as CI and the backup, with the same logs and the same secret store. A failed
sync is visible where someone is already looking.

## Consequences

- The sync depends on GitHub Actions availability. An Actions outage stops
  discovery. It does **not** stop Team HQ: §7 forbids operational state
  depending on Notebook, and Gate 2 proved the isolation with 0 inbound
  foreign keys, so a stalled sync degrades knowledge freshness and nothing
  else.
- Actions minutes are consumed. Six runs an hour on a public repository is
  free; on a private one it is roughly 4,300 minutes/month at one minute per
  run, which exceeds the 2,000-minute free allowance. **This is the real cost
  of the decision and it is recorded rather than discovered**: if the
  repository stays private, either the interval widens or the schedule moves.
  Measured runtime so far is ~30 s, so the true figure is nearer 2,200
  minutes/month — still over.
- Cloudflare Workers Cron remains the better answer if the cadence ever needs
  to be guaranteed, or if the minutes become the binding constraint before the
  freshness target does.

## Alternatives

| | |
|---|---|
| **Cloudflare Workers Cron** | As specified, and genuinely better at guaranteed cadence. Costs a new provider and credential for a job two existing workflows already do. Revisit if cadence or minutes bind. |
| **Supabase pg_cron** | No new provider at all, and the closest thing to free. Rejected because the sync shells out to Python for the adapter, and pg_cron cannot: it would mean re-implementing the private RPC in SQL or PL/Python, which is exactly what ADR-0003's adapter boundary exists to avoid. |
| **A long-running worker** | Removes the scheduler entirely. Needs somewhere to run continuously, which is a paid tier everywhere that matters, and Phase 4 does not need one. |
