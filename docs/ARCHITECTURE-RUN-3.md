# Architecture Run 3 — trusted identity, sender authorization, effect boundary

Status: **PARTIAL.** Identity and anon work is live in production; the #386 effect-door work (migrations 0616–0618 and the handlers that depend on them) is proven in the isolated replica and **not yet deployed**.

## Proven in production
- 0613 (public key reaches no function), 0614 (credential is not a person), 0615 (Slack stranger gate) applied.
- hq-api v798: `hq.api_token` is a `service` principal, limited to `SERVICE_MAY`; a test member reaches only the allow-list and by-bearing actions.
- signin, voice, slack-events deployed with principal/admission changes.

## Proven isolated only (not deployed)
- 0616 approval binding, 0617 stale-button binding (`d.created_at`), 0618 test principal cannot speak/grant in a real project.
- Handlers: `approval-gate`, `notebook` (generate/add_source/push_document), `plan`, `vault-export`, `callbacks`, `telegram-webhook` changes.
- Replica suites: 37 suites, all green (approval-binding 30/30, vault-export-door 5/5, principals 69/69, slack-sender 17/17, anon-surface, sender-authorization 39, approver-identity 44, refusal-reversal 41). vitest 3692/3692, tsc, biome ci, check:secrets/templates/migrations clean.

## Deploy order (when authorized)
1. `npm run migrate` (0616, 0617, 0618) — **before** the worker: the worker reads `app.approval_verdict` and `app.approval_for_delivery`.
2. Deploy worker, then telegram-webhook.
3. hq-api needs no redeploy (unchanged since v798).
Rollback: 0616–0618 are additive functions/one config row; restore prior worker + telegram-webhook versions (worker v860 pre, telegram v612) and the old functions from `.out/defs`; `docs/architecture-run-3/rollback-*.sql` cover 0613–0615.

## Remaining debt
System-duty approvals (#389, #391, #393, #394), residual sender cross-check (#392); the collateral verify suites still fake writers with the office key and need the harness session; production live verification of Phase B; main not advanced.
