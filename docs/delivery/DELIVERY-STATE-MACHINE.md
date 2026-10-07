# Delivery state machine (migration 1029, N1)

Table `public.deliveries`, one row per `dedupe_key` (the unique key is the claim). The enum `slack_delivery_state` has
four values; the sub-states of `claimed` are derived from `lease_expires_at`, `error_code` and `send_started_at`.

| State | Meaning | Who may move it | Next |
|---|---|---|---|
| `claimed`, lease live, no `send_started_at` | A sender holds the claim and has not called the provider | `app.claim_delivery` (insert is the lock) | `begin_delivery_send`, or lapses |
| `claimed`, lease live, `send_started_at` set | IN FLIGHT: the provider call is being made | `app.begin_delivery_send` (fence: the attempt must match and no send already began) | `sent`, backing off, or lapses |
| `claimed`, lease live, `error_code` set | BACKING OFF after a reported retryable failure (429, 5xx). Wait = max(exponential, provider Retry-After up to `delivery.retry_after_cap_seconds`) | `app.record_delivery_failure` | due when the lease lapses |
| `claimed`, lease lapsed, no `send_started_at` | DUE: nothing began, or the provider refused. Safe to send | `redriveLapsedDeliveries` through the same notifier; `claim_delivery` reclaims (attempt + 1) | `sent`, backing off, `failed` |
| `claimed`, lease lapsed, `send_started_at` set | AMBIGUOUS: a send began and nothing recorded how it ended. The provider may have accepted it. NEVER resent automatically | `claim_delivery` (on reclaim) or `app.settle_lapsed_deliveries`, whichever sees it first | `failed` `indeterminate:lease_lapsed_mid_send` |
| `sent` | TERMINAL. Provider accepted it, `message_ref` recorded | `app.record_delivery_sent` | none |
| `failed` | TERMINAL. `error_code` says why (below). Listed by `app.undelivered` unless `superseded:*` | `record_delivery_failure` (terminal refusal, `gave_up` after `delivery.max_attempts`), the sweep | `indeterminate:*` can be resolved by `resolve_indeterminate_delivery` (reconcile) and any `failed` can be re-queued by a person with `retry_delivery` |
| `suppressed` | TERMINAL. Containment refused the destination (harness job, retired test destination, no provenance) | `claim_delivery`, or the sweep re-asking `delivery_refusal` | none |

`failed` codes: a provider code (`chat_not_found`, `blocked_by_user`, `http_500` after the last attempt) is a definite
refusal; `indeterminate:*` may have landed; `abandoned:*` was never sent and the office stopped trying;
`superseded:sent_by_sibling` means the same job already reached that chat on another delivery (bookkeeping, not listed).

## What each failure does

| Event | Recorded as | Redelivered? | Surfaced? |
|---|---|---|---|
| First delivery succeeds | `sent` | no | n/a |
| 429 (Telegram `retry_after`, Slack `Retry-After`) | retryable, wait at least the provider's | yes, when the wait is over, bounded by `delivery.max_attempts` (5) | after the last attempt: `delivery.gave_up` event and the undelivered list |
| 5xx the provider reported | retryable, exponential 30, 60, 120, 240 s, ceiling 900 s | same | same |
| Network failure BEFORE any request bytes left (DNS `ENOTFOUND`/`EAI_AGAIN`, `ECONNREFUSED`, `ENETUNREACH`/`EHOSTUNREACH`, undici connect timeout, TLS handshake or certificate failure, invalid URL; classified in `src/channels/network-failure.ts` from the error's `code` through its `cause` chain, every address of an `AggregateError` must qualify) | retryable `network_before_send:*` | yes, one attempt per backoff step, bounded by `max_attempts` | after the last attempt, as for 5xx |
| Failure AFTER the request may have been sent (read timeout, `ECONNRESET`, `EPIPE`, response lost) or any code not on that list | `failed indeterminate:*` | NOT automatically (it may have landed). Slack can `reconcile`; Telegram cannot. A person or a reconcile makes it owed again | undelivered list ("did not say whether it arrived") |
| 400 chat not found, 403 bot blocked, unknown | `failed` at once | never | undelivered list, `delivery.failed` event |
| Two workers, one key | one claim wins, the other is `held`; a second sender of the same attempt is `fenced` | n/a | n/a |
| Worker dies before the provider call | row `claimed`, no intent | yes, by the redrive (attempt + 1) | n/a |
| Worker dies after the provider call, before recording | row `claimed` with intent | NO: parked `indeterminate:lease_lapsed_mid_send` | `delivery.unconfirmed` event and the undelivered list |
| Harness job / retired destination | `suppressed` | never | counted by `check:leaks` |

## The residual at-least-once and at-most-once windows (honest)

* Telegram has no idempotency key and a bot cannot read its own messages, so the crash window between the provider
  accepting a message and `record_delivery_sent` cannot be made exactly-once. The design picks the conservative side:
  the message is **not** resent, and the row says visibly that it is unconfirmed. The cost is that if the provider had in
  fact NOT accepted it, the answer waits for a person (`retry_delivery`) or, on Slack, for a reconcile.
* A retry after a failure the provider REPORTED (429, 5xx with a body) is safe: the provider said it did not accept.
* Slack's 5xx on a write and every network error that is not provably pre-send are classified indeterminate by the
  client (`src/slack/api.ts`, `src/telegram/api.ts`), so they park rather than retry. That is a deliberate choice of
  at-most-once over at-least-once for ambiguous errors. An unknown error code is treated as ambiguous.
* Who learns of a terminal failure: it is on `app.undelivered` (read by the studio) and in the events ledger. The
  `owed_a_word` mechanism covers FAILED turns only and skips a job that has any delivery row, so a completed answer
  whose delivery failed is not told on a chat channel. A one-line notice on a different channel (for example Slack when
  Telegram failed) would be cheap but is a new outward message and is NOT implemented.
* Several channels for one job are independent rows; the notifier's one-message-per-surface rule plus the sweep's
  `superseded` rule keep two rows from putting two messages in one chat, but two different chats legitimately get one each.
* Time is the database clock. A lapsed lease is detected on the next worker tick (about a minute), so a retry is never
  earlier than its backoff and is up to a tick later.

## Moving parts

* `app.claim_delivery` (fence on the key; refuses a reclaim of an ambiguous row), `app.begin_delivery_send` (attempt
  fence plus intent record), `app.record_delivery_sent`, `app.record_delivery_failure` (backoff, bound, provider wait),
  `app.settle_lapsed_deliveries` (gives every lapsed claim an ending), `app.deliveries_to_redrive` (the due list),
  `app.undelivered` (the surface), `app.retry_delivery` and `app.resolve_indeterminate_delivery` (the two human or
  reconciling doors, both clear the intent record).
* TypeScript: `DeliveryService` (`src/channels/delivery.ts`), `redriveLapsedDeliveries` (`src/jobs/delivery-redrive.ts`,
  called from `drain` in `src/jobs/worker.ts`).
* C2: `app.reopen_duty_voice` ages the duty's `duty_said` record when its announcement ends in a definite failure with
  nothing sent, so the next identical run speaks.
* C3: `app.job_delivery_state(office, job)` returns `sent | pending | failed | none`. A reminder should set `reminded_at`
  only when it returns `sent` (and clear it, or not set it, on `failed`); `reminders.ts` belongs to the reminders change.

Proofs: `tests/channels/delivery-redrive.test.ts`, `scripts/isolated/dl-delivery-redrive.ts` (replica).
