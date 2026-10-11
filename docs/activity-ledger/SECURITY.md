# Unified Activity Ledger - security, privacy and redaction

The ledger must not become a second, ungoverned store of private information, and must not become a new route across an office boundary. Each
control below names the test that fails when it is removed. The sabotage runner (`scripts/isolated/activity-ledger-sabotage.sh`) removes 26 of them
on a copy, one at a time, and requires the named proof to go red; the last full run caught **26 of 26** (in three batches, each ending with the unmodified control green: 76/76 and 17/17).
Running them found one control that had gone vacuous after an optimisation (S9) and it was repaired. Unit-level sabotages are listed at the end. Everything reviewed independently
(`RELEASE-READINESS.md`, section 1) was reproduced by the reviewer on a clone before it was fixed, and each fix has a check that fails on the code before it.

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
| An external worker widens its own reach | One door; type must be `external_writable`; actor forced to `external:<name>`; `provenance = external` forced and a `check` ties it to `actor_kind`; no `critical`; no `confirmed` or `authorised`; metadata cannot name the actor; **`external.review_decided` (a person's decision) is not worker-writable** | `activity-ledger` (S6, six refusals, a spoof attempt, a direct insert), `activity-ledger-review` |
| An external worker forges a link, a cause or a record | Evidence is cleaned like metadata, bounded to 1 KB and always `kind: external` (it can no longer pose as a link into an approval or a delivery); the correlation is **taken from the job** and a mismatch, or a correlation no work of the office has, is refused | `activity-ledger-review` (S19) |
| An external worker fills the table (it is append-only, on a 500 MB tier) | 300 new reports an hour per worker and 1 000 per office, refused with `54000`; a retry of an already-accepted report is never refused, and another worker is unaffected | `activity-ledger-review` (S24) |
| A long string holds a CPU at the door | `app.activity_redact` redacts and returns at most the first 4 000 characters (its long-opaque pattern was quadratic: 6.1 s at 80 000 characters, 15 ms after); the tail is dropped, never returned unredacted | `activity-ledger-review` (S23) |
| A future-dated event pins itself to the top of every feed | The strict writer refuses a date more than five minutes ahead | `activity-ledger-review` |
| A person is told they said yes when they did not | An approval is `granted` only where the question is positively an approval and the answer is not the writer's named decline; a no only for that decline; anything else is `approval.answered` with the option as text; a closed question nobody answered is "closed" | `activity-ledger-review` (S18) |
| A person's word is shown as a provider's | A delivery a person marked as arrived (`confirmed-by-person:`) is `completed`, `provider_confirmed: false`, "marked as delivered by you" | `activity-ledger-review` (S22) |
| A failure reason (handler or provider text) is shown to an ordinary reader | `metadata.reason` is returned only to a diagnostic reader, and only for a state a reason explains | `activity-ledger-review` |
| An HTTP caller writes to the ledger (Hermes or anyone) | No public wrapper exists for any writer, no HTTP role can execute one or use schema `app`, the gateway names none, and the contract says the door is not exposed | `activity-ledger-review`, `tests/gateway/activity-no-write-door.test.ts` |
| A diagnostic type is shown as ordinary activity | A trigger refuses a native row below its type's default visibility | `activity-ledger` (S8) |
| Operator-only events reach an ordinary person | `operator` is capped to `diagnostic` unless `app.office_sees_the_deployment` | `activity-ledger`, `activity-gateway` |
| History is rewritten | Update, delete and truncate refused (trigger shared with `public.events`); moving an event to another office refused (write-once office) | `activity-ledger` (S2) |
| A suite's traffic appears as a person's | `jobs.synthetic`, `jobs.is_fixture`, then `app.harness_job`, applied to the newest candidates; a command a door stamped synthetic is excluded; a job-less row (a question, an action) in a **fixture project** is excluded too | `activity-ledger` (S7, S16), `activity-ledger-review` (S25) |
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
- **Independent model review of 1060 to 1062 (phase 3; a model, NOT a human security approval).** It found no cross-office read or write path and no SQL injection, and these hardening gaps, all fixed in the unapplied files and
  each with a regression check and sabotage (`activity-external-attack`, S31 to S38): the best-effort writer wrote a failure counter while the switch was off, and the external door did validation and quota work while off (both now return null first);
  native `evidence_ref`, `actor`, `tool` and `model` were stored uncleaned (now redacted, evidence bounded to 1 KB); the strict writer trusted its actor and provenance, so a holder of EXECUTE could forge `external.review_decided` or an external actor (a native writer
  now cannot write an `external.*` type or an external actor); an external summary could imitate "You said yes:" (now prefixed `[external:<worker>]`); five read functions had `public` before `pg_catalog` in `search_path` (proved hijackable by a role holding CREATE on
  `public`; now `pg_catalog` first); rotating worker names could add about 1 000 undeletable rows an hour per office (now a daily per-office cap of 4 000 and a deployment-wide cap of 5 000 an hour); a filter that matches nothing widened every source's pool
  (a status outside the vocabulary is now refused outright and `activity_read` carries an 8 s statement timeout). **Not changed, documented:** the first row to supersede an activity claims its one correction permanently (any strict-writer holder can pre-empt a correction);
  a native `correlation_id` from another office is not validated on the native path (nothing leaks: reads are office-bound, the row only stores the uuid); `activity_health` shows the deployment-level `indexes_missing` list to a signed-in office (counts are per office);
  helper functions are PUBLIC-executable but nobody holds USAGE on schema `app`. Every one of those requires holding EXECUTE on `app` functions, which only the owner and the worker's database role do.
- **Timing and size side channels** (whether a filtered read was fast because it found nothing) were not analysed.
- **The strict redactor (phase 3) and what it still does not catch.** The ledger uses its own redactor, `app.activity_redact` (SQL) with a byte-identical TypeScript twin `redactStrict`
  (`src/text/secrets.ts`); the office-wide `redactSecrets` is unchanged. It reads at most 4 000 characters, NFKC-normalises (full-width letters, unusual spaces), removes invisible
  format characters (zero-width, bidi, soft hyphen, variation selectors), then removes vendor keys (including Stripe, SendGrid, npm, Hugging Face, GitLab, Twilio, Slack webhooks), credentials
  in a URL, `Token:value`, an assignment to a credential-named key (`password=`, `"token": "..."`) and a long mixed run, in linear time. Token counts and durations are left alone.
  `scripts/isolated/activity-redaction.ts` (71 checks, with a fuzz) fails on any SQL/TS difference. **It does not claim to find every secret.** Not caught, and pinned as limitation tests:
  a short secret in prose with no key name; a credential-named key written in look-alike letters from another script; percent-encoded or base64-wrapped values; a secret split by ordinary
  punctuation; a value in a language the key list does not know. The control that bounds the rest is that native callers pass references and short summaries and that external metadata
  passes a strict allowlist (`app.activity_external_metadata`).
- **Native events make a project permanently undeletable** (a same-office foreign key on an append-only table), the same class as a project that has gathered a job. `app.project_delete` refuses it gracefully; no
  product path writes a native event to a project with no job yet. A fixture project that a suite tears down must not receive native events.
- **Timestamps of a settled delivery are its row's last change**: `delivery.failed` and `delivery.suppressed` are dated `updated_at`, the only column that records when, and a later update to the settled row moves the
  event. A consumer that needs the first time should read it from the delivery row itself.
- **Causation is only as good as the column.** A `job.delegated` points at the parent's creation, which is a diagnostic event: a link may name an event the caller's visibility hides, and consumers must tolerate it.
  Events written in one transaction share a timestamp and are ordered by id, which is deterministic and not causal; causality is `causation_id`.
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
