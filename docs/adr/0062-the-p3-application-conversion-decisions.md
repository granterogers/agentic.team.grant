# 0062 - the P3 application conversion decisions

Status: **accepted** (2 October 2026). Implements ADR-0060 and ADR-0061 for the application. Records what converting it
decided that a later reader could reverse by accident. Canonical record: `docs/multi-user/P3-RECORD.md`.

## Decisions

1. **`IDENTITY -> TRUSTED OFFICE CONTEXT -> RESOURCE CHECK`, never the other way round.** A caller-reachable function takes
   `p_office` as its FIRST argument, with no default, from a trusted component (the gateway from a verified login, the worker
   from a claimed job), calls `app.require_office(p_office)` first, writes `office_id` explicitly, and answers a foreign id
   exactly as it answers one that does not exist. A function that receives a resource and derives the office from it is
   asking the attacker which office to trust.
2. **Six identity doors take no office, by design:** `mcp_client_for`, `mcp_code_challenge`, `mcp_redeem_code`,
   `sender_admitted`, `record_telegram_chat`, `enqueue_inbound`. Each one IS the resolution of an identity (a client
   token, a code, a Telegram sender, a Slack workspace) and produces the office the rest of the call uses. Each is proved
   by an `identity-door:` case.
3. **Model calls with no job belong to the SYSTEM office, written explicitly.** 8,099 of them were deployment overhead
   (capability probes, health checks) and had been filed under the only person by the bridge. `recordUsage` now says
   `app.system_office()` for a call with no job, and `app.job_office(job)` otherwise.
4. **The office key (machine key) resolves to the TEST office, not to a person.** It is a credential for the deployment's own
   tooling and harness. A suite that needs a person's data signs in as that person's operator. A reading taken with the
   machine key therefore sees the test office (`verify:hq`'s connections rows are empty for that reason).
5. **The compatibility bridge is removed (0860) and the meter table is kept.** A writer that names no office fails on NOT
   NULL (`23502`) in every state, including the one in which the person is the only real office. `public.office_bridge_use`
   stays as the evidence of what relied on the bridge. The enforcement catalogue now FAILS if a bridge trigger exists.
6. **A meter that counts what ran cannot see what has not run.** Six writers (`record_signal`, `record_connection_health`,
   `record_slack_history`, `suppress_delivery`, `unlearn`, the task tombstone trigger) were classified
   `OFFICE_TRUSTED_DERIVED` with no door and relied on the bridge while the meter read zero, because they are operator
   commands and rare paths. 0859 converted them. `npm run check:carrier-writers` reads every function body for an insert
   into a carrier that omits `office_id` and is in the gate.
7. **A function that a column default, a generated column, a CHECK, a policy or an index expression calls must be
   executable by the role that WRITES the row.** PostgREST writes as `service_role`, which has no usage on schema `app`.
   0841 revoked EXECUTE from every `app` function; four of them (`now_utc`, `normalise_name`, `normalise_reference_url`,
   `icon_key_ok`) are called by defaults and an index, so every insert through the webhooks failed for about five minutes
   until 0842 granted exactly those four. They are the four `app` functions open to browser roles, on purpose.
8. **Operator tools act in the operator's office.** `npm run inventory`, `slack:backfill`, `slack:rotate`, `deploy:mcp`
   and `office:ask` name `app.operator_office()`. Harness tools (sessions, suites) name `app.test_office()`.
9. **Global unique keys that stay global, and why.** A credential hash, a system-composed dedupe or idempotency key and an
   external provider id identify a thing across the deployment. Three keys that a person chooses and that could still
   collide across offices are NOT yet per-office and are tracked as follow-ups, for example `connection_health (service,
   credential)` (the Google writer guards its conflict target by office), `workspace_layouts`,
   `documents_one_per_linked_file`, the calendar and mail keys and `sync_runs_one_at_a_time`.
   `signals (source, external_ref)` became per-office in 0859.
10. **A function that reports refusal in its return value must be read by its caller.** `check:arity` reads every function
    body for a call whose argument list matches no overload; it exists because dropping an old overload turns every caller
    of the old shape into a runtime error that a parser never sees.

## What would reverse this

Putting a default office back on any carrier column, re-creating `a0_office_bridge`, granting EXECUTE on an office-taking
function to a browser role, or letting a public function take an office anywhere but first. Each is a failing check
(`check:office-edges`, `check:office-conversion`, `check:anon-exposure`).
