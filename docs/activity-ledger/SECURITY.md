# Unified Activity Ledger - security, privacy and redaction

The ledger must not become a second, ungoverned store of private information, and must not become a new route across an office boundary. Each
control below names the test that fails when it is removed. The sabotage runner (`scripts/isolated/activity-ledger-sabotage.sh`) removes 17 of them
on a copy, one at a time, and requires the named proof to go red; the last full run caught **17 of 17**, and the unmodified control ran green
(76/76 and 17/17). Unit-level sabotages (7) are listed at the end.

## What is protected, and from whom

| Threat | Control | Proof (goes red if the control is removed) |
|---|---|---|
| A person reads another office's activity by naming its project, job, correlation, agent or cursor | Every source is bound to `office_id = $1` where `$1` is the office the **gateway** took from the verified session, in the source stage **and** in the branch (two independent layers); an id from another office matches nothing | `activity-ledger` isolation (S1, S12), `activity-gateway` |
| A caller picks the office | The SQL takes the office as its first argument; only `service_role` may execute it; the gateway fills it, and a section without `office: true` is refused by `tests/gateway/operator-only.test.ts` | `tests/gateway/activity-sections.test.ts`, grants asserted in `activity-ledger` |
| A browser key reads or writes the ledger | `revoke all` on the three tables and every function from `anon`, `authenticated` and `public`; forced row security with policies for the application role only | `activity-ledger` (privilege check) |
| A write attaches another office's project or job | Same-office composite foreign keys `(project_id, office_id)`, `(job_id, office_id)`, `(parent_job_id, office_id)`, `(supersedes_activity_id, office_id)` | `activity-ledger` (the two cross-office writes, the external one) |
| A missing or disabled office is defaulted | `app.require_office` refuses; nothing defaults to a person | `activity-ledger` |
| A secret is stored | `app.activity_redact` (twin of `src/text/secrets.ts` plus a PEM header) on every summary and every string value; credential-named keys (`secret`, `token`, `passw`, `authorization`, `api_key`, `cookie`, `credential`, `bearer`, `private_key`, `session`, `signature`) are replaced by a marker whatever they hold | `activity-ledger` (S3), `activity-redaction` (37 cases, SQL and TypeScript byte-identical) |
| Message or document text is stored | Content-named keys (`body`, `text`, `content`, `transcript`, `instruction`, `prompt`, `message`, `document`, `payload`, `raw`, `headers`, `email`, `address`, `phone`, `query`) are replaced; projected events carry **references** (`evidence`) and never copy a body, a transcript, a destination id or a reason text; the worker's recovery event sends a state name and an attempt only | `activity-ledger` ("no message text, document text or destination id is in the feed"), `tests/activity/record.test.ts` |
| Malicious or careless metadata | Refused, not cleaned: not an object; a key that is not a short snake-case word; more than 40 keys; deeper than 4 levels; over 4 KB. Summary cut at 300 characters; strings at 200; arrays at 20 | `activity-ledger` (five abuse cases, each refused for its own reason) |
| An external worker widens its own reach | One door; type must be `external_writable`; actor forced to `external:<name>`; `provenance = external` forced and a `check` ties it to `actor_kind`; no `critical`; no `confirmed` or `authorised`; metadata cannot name the actor | `activity-ledger` (S6, six refusals, a spoof attempt, a direct insert) |
| A diagnostic type is shown as ordinary activity | A trigger refuses a native row below its type's default visibility | `activity-ledger` (S8) |
| Operator-only events reach an ordinary person | `operator` is capped to `diagnostic` unless `app.office_sees_the_deployment` | `activity-ledger`, `activity-gateway` |
| History is rewritten | Update, delete and truncate refused (trigger shared with `public.events`); moving an event to another office refused (write-once office) | `activity-ledger` (S2) |
| A suite's traffic appears as a person's | `jobs.synthetic`, `jobs.is_fixture`, then `app.harness_job`, applied to the newest candidates; a command a door stamped synthetic is excluded | `activity-ledger` (S7, S16) |
| The ledger is switched on by accident | Default **off**; the switch **fails closed** (absent setting, or any value but JSON `true`, is off) | `activity-ledger` (S5, S5b) |
| A broken writer floods the table or recurses | Failures are counted (not recorded as events) and stop at 200 an hour per office; the health reading writes nothing | `activity-ledger` (S10) |
| The gateway turns a bad parameter into a database error or a wrong page | Ids, instants, counts and words are shape-checked and refused by name with a 400; an instant is passed on as written, because a rounded cursor skips rows | `activity-gateway`, `tests/gateway/activity-sections.test.ts` (S13, S15) |
| A read is expensive enough to deny service | Page at most 200; pool at most 16 384 rows a source; chain at most 500; `partial` is reported rather than looping | `activity-ledger-perf` |

## Redaction strategy

One redactor for text and one cleaner for metadata, in the database, called by every writer **and** by the read model for the free-text columns it
projects (`state_reason`, `error_code`, `suppressed_reason`, `requested_action`, `needed`). A writer cannot forget to call it because the function
that inserts calls it. Redaction is over-eager by design (it prefers to eat a harmless string than leak a live one); the near-miss cases (a UUID, a
price, a time, a long word with no digit, the word "bearer" in prose) are in the parity proof so over-eagerness is as visible as a leak.

Redaction replaces; it does not detect-and-warn. Because a pattern list can go stale (the next connector has its own shape), the stronger control is
the one above it: **content never enters the ledger**; it holds references to records the existing, authorised readers already protect.

## What is not protected, stated plainly

- **The service key.** Everything reaches the ledger through `service_role`; anyone holding it reads every office, as they can read every table today.
- **Rendering.** The summary is plain text. The page escapes text it renders (`esc()`); the database does not HTML-sanitise. A new consumer must escape.
- **Redaction is pattern-based.** A credential in a shape no pattern knows, written to a free-text field by a native caller, is stored. The control
  that bounds this is that native callers pass references and short summaries; there is no path for a long free-text body.
- **Approval and impediment summaries carry the office's own one-line description** of what it asked (`blockers.requested_action`, `job_impediments.needed`),
  cut at 160 characters and redacted. They are sentences a handler composes ("Create the Slack channel for the venue project"), not a person's message, and
  they are shown only to the office they belong to, but they can name a project or a person's work. A deployment that wants them out of the feed removes
  them from the two branches; nothing else depends on them.
- **`app.activity_for_the_page` splits the summary into a verb and an object at the first space** to fit the existing renderer; that is cosmetic and can read oddly.
- **Timing and size side channels** (whether a filtered read was fast because it found nothing) were not analysed.
- **`public.activity_write_failures` is not pruned** (it is a bounded counter, at most 200 rows an hour per office). A prune after 90 days is proposed, not built.

## Retention

Nothing is deleted. The native table is append-only and its delete is refused by a trigger, so retention is a decision for a person, not a job.
Rationale: the native events are the ones with no other record, so deleting one destroys the only copy; the projected events are the existing tables'
own rows and keep the retention those tables have. A native event is about 660 bytes with its indexes, so one hundred thousand of them are about 66 MB
(the free-tier database allowance is 500 MB and `capacity-watch` already measures every table); at the expected native volume (recoveries, thresholds,
throttles, external reports: tens a day) the growth is not the limiting resource. **Proposed, for Grant to decide when it matters:** move native events older than a stated
age to a cold table with a verified copy, never a delete, and do it per office. Until then: keep.

## Unit-level sabotage (run by hand, recorded in `PROGRESS.md`)

Removing the worker's call (`tests/activity/record.test.ts`), its `.catch`, its attempt in the key, the chain's `requireOne`, the verbatim instant,
a taxonomy row the read model emits, and the page's `enabled === true` guard each turned the named test red; the first attempt at one of them
produced a syntax error rather than a red test and was redone as a valid mutation (a sabotage that did not apply is not a passing control).
