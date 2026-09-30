# Architecture Run 3 — trusted identity, sender authorization, effect boundary

Status: **promoted to production and verified**; see below. Remaining debt is listed at the end.

## Proven in production
- 0613 (public key reaches no function), 0614 (credential is not a person), 0615 (Slack stranger gate) applied.
- hq-api v798: `hq.api_token` is a `service` principal, limited to `SERVICE_MAY`; a test member reaches only the allow-list and by-bearing actions.
- signin, voice, slack-events deployed with principal/admission changes.

## Production promotion (30 September 2026)
- Branch `claude/architecture-run-3-identity`, tip verified 0 behind `main` (`e9c632f3`). No other branch touches migrations 0613+.
- `npm run migrate` applied 0616, 0617, 0618 (631 recorded). Verified: `app.approval_verdict`, `app.approval_for_delivery`, `approval.fingerprints_from` exist; 0 public functions reachable by a public key.
- Worker v860 -> **v865**; telegram-webhook redeployed (probe: webhook pending 0, no error). hq-api stays **v798**: its source and signin, voice and slack-events are byte-identical to the live hotfix (`git diff 6ac4ac37..HEAD` empty).
- Live: run1 15/15, run2 53/53, run3-identity 26/26, run3-effects (new) 12/12. The eight-endpoint escalation probe and the 0618 chain (a test principal speaking in a real project) now have live checks.
- Fixtures torn down; 16 stale Run 2 fixture questions closed; `check:leaks` exit 0 (known/acknowledged only, 0 new).

## Proven in production
Everything in the list above plus: forged and unasked approvals give `forged`/`none`; a stale or unknown delivery binds no question; an asking-job claim runs once and refuses a retry and a deferred sibling; vault export stays disabled and sent nothing.

## Proven isolated only (37 replica suites, 39 pass-lines, 30/30 approval-binding)
The handler paths through the deployed worker: notebook.generate/add_source/push_document and office.execute_plan with ambiguous remote failure, quota-only clean failure, plan resume; Telegram staff-lookup/enqueue outage and redelivery; button-press release on throw; vault-export recipient restriction. Driving these live would need a real notebook or a real Telegram send; they are not driven live.

## Rollback
Restore worker to the prior version and telegram-webhook to its prior source; 0616-0618 are additive (functions and one config row); `docs/architecture-run-3/rollback-*.sql` cover 0613-0615.

## Remaining debt
System-duty approvals (#389, #391, #393, #394), residual sender cross-check (#392); the collateral verify suites still fake writers with the office key and need the harness session; production live verification of Phase B; main not advanced.
