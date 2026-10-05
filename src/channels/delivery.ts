/**
 * Sending a message exactly once, on any channel.
 *
 * Lifted out of `src/slack/office.ts` when Telegram needed the same thing, and
 * the lifting is the point: the invariant — *a message is sent at most once,
 * and we can always say whether it was* — is a property of delivery, not of
 * Slack. Two implementations of it would drift, and the one that drifts is the
 * one that posts twice.
 *
 * The sequence is fixed and cannot be reordered:
 *
 *   1. claim in Postgres (`app.claim_delivery`)
 *   2. send
 *   3. record the outcome
 *
 * Claiming first costs one round trip and buys the only thing that makes a
 * duplicate harmless. Sending first and recording afterwards is the natural
 * order and is wrong: two concurrent deliveries would both send before either
 * recorded.
 *
 * ## What a Transport must be honest about
 *
 * The one place the channels genuinely differ is reconciliation. After an
 * indeterminate send — the response was lost, so the message may or may not
 * exist — Slack can be asked, because a bot can read channel history and every
 * message carries a marker. **Telegram cannot be asked at all**: a bot cannot
 * read its own sent messages back. So `reconcile` is optional on the interface
 * and a transport that cannot do it says so by not implementing it, rather than
 * implementing a version that guesses. A delivery on such a channel stays
 * parked forever, which is the correct outcome: never sending it again is the
 * only guarantee available, and it is the safe one.
 */

import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null | undefined): string =>
  v === null || v === undefined ? 'null' : lit(v)

export type DeliveryChannel = 'slack' | 'telegram' | 'voice' | 'teamhq'

export type DeliveryPurpose = 'result' | 'progress' | 'blocker' | 'ack' | 'briefing' | 'notice'

export type DeliveryOutcome =
  | 'sent'
  | 'already_sent'
  | 'held'
  | 'suppressed'
  /** Sent, then found to have been suppressed. The caller must retract it. */
  | 'suppressed_too_late'
  | 'failed'
  /** Sent or not — unknown. Reconcile before doing anything. */
  | 'indeterminate'

/** How a transport failed, in the only four ways a caller can act on. */
export type TransportFailureKind = 'retryable' | 'terminal' | 'needs_human' | 'indeterminate'

export class TransportError extends Error {
  constructor(
    readonly code: string,
    readonly kind: TransportFailureKind,
  ) {
    super(`transport failed: ${code}`)
    this.name = 'TransportError'
  }
}

export interface SendRequest {
  readonly targetRef: string
  readonly threadRef: string | null
  readonly dedupeKey: string
  /**
   * What this message is about, so a transport can offer feedback on it.
   *
   * Passed through rather than left to the caller because of #59. Grant asked
   * for thumbs up and down on his Telegram messages; the reply path was fixed
   * and four other senders still had none, and patching each is how the next
   * sender ships without them too. A transport that can default the buttons
   * needs the correlation, and this is the only place that already has it.
   */
  readonly correlationId: string | null
  readonly purpose: DeliveryPurpose
  readonly body: unknown
}

export interface SendResult {
  readonly messageRef: string
  readonly link?: string | null
}

export interface Transport {
  readonly channel: DeliveryChannel
  /** Throws `TransportError` for every failure, including "ok: false" ones. */
  send(request: SendRequest): Promise<SendResult>
  /**
   * Did an indeterminate send actually land?
   *
   * Returns the message reference if found, null if provably absent, and
   * throws if the LOOK failed — in which case the answer is still unknown, and
   * saying otherwise is the whole bug.
   *
   * Absent on channels that cannot answer. See the header.
   */
  reconcile?(
    targetRef: string,
    dedupeKey: string,
    threadRef?: string | null,
  ): Promise<string | null>
  /** Remove a message that should not have been sent. */
  retract?(targetRef: string, messageRef: string): Promise<boolean>
}

export interface DeliveryRequest {
  readonly dedupeKey: string
  readonly accountRef: string
  readonly targetRef: string
  readonly threadRef?: string | null
  readonly purpose: DeliveryPurpose
  readonly staffId?: string | null
  readonly correlationId?: string | null
  readonly jobId?: string | null
  /**
   * The office this message is sent FOR. Almost every sender has a job and leaves this out: the office is then the
   * job's (`app.delivery_office`). A sender with no job passes it, or - if the destination is a registered test
   * destination or the sender a registered operator - gets the test or the operator's office; anything else is the
   * system office and is refused for want of provenance (0883: missing provenance never means the operator). Never a
   * value taken from a request: a delivery claimed for the wrong office is a message sent in the wrong person's name.
   */
  readonly officeId?: string | null
  /**
   * The question this message asks, when it asks one (#396, 0623). Recorded on the delivery BEFORE the message is
   * sent, so a press or a reply to it names exactly this question - not the latest one its job happened to have.
   * A message that asks nothing leaves it out, and a press on it answers nothing.
   */
  readonly blockerId?: string | null
  /** Whatever the transport needs to send. Opaque here, by design. */
  readonly body: unknown
}

export interface DeliveryResult {
  readonly outcome: DeliveryOutcome
  readonly deliveryId: string | null
  readonly messageRef: string | null
  readonly attempt: number
  readonly errorCode: string | null
}

interface ClaimRow {
  delivery_id: string
  outcome: string
  message_ref: string | null
  attempt: number
}

export class DeliveryService {
  constructor(
    private readonly db: SqlExecutor,
    private readonly transport: Transport,
  ) {}

  get channel(): DeliveryChannel {
    return this.transport.channel
  }

  /**
   * Send a message, exactly once, or explain why not.
   *
   * Never throws for an ordinary transport failure: a delivery that could not
   * be made is a fact to record, not an exception to propagate into a job that
   * was otherwise fine. It throws only when the DATABASE will not answer,
   * because then nothing about the claim can be trusted.
   */
  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const office = this.officeFor(request)
    const claim = await this.claim(request, office)
    const base = { deliveryId: claim.delivery_id, attempt: claim.attempt, errorCode: null }
    // Named before it can be answered. Never throws: a message that could not be bound still goes out, and a press
    // or a reply on it answers nothing (fail closed), which is better than a question nobody was told about.
    if (
      request.blockerId !== undefined &&
      request.blockerId !== null &&
      ['claimed', 'reclaimed', 'already_sent'].includes(claim.outcome)
    ) {
      await this.db
        .execute(
          `select app.bind_delivery(${office}, ${lit(claim.delivery_id)}::uuid, ${lit(request.blockerId)}::uuid)`,
        )
        .catch(() => undefined)
    }

    switch (claim.outcome) {
      case 'already_sent':
        return { ...base, outcome: 'already_sent', messageRef: claim.message_ref }
      case 'held':
        return { ...base, outcome: 'held', messageRef: null }
      case 'suppressed':
        return { ...base, outcome: 'suppressed', messageRef: null }
      case 'failed':
        return {
          ...base,
          outcome: 'failed',
          messageRef: null,
          errorCode: 'previous_attempt_failed',
        }
      default:
        break // 'claimed' or 'reclaimed' — ours to send.
    }

    let result: SendResult
    try {
      result = await this.transport.send({
        targetRef: request.targetRef,
        threadRef: request.threadRef ?? null,
        dedupeKey: request.dedupeKey,
        correlationId: request.correlationId ?? null,
        purpose: request.purpose,
        body: request.body,
      })
    } catch (error) {
      return this.recordFailure(claim, error, office)
    }

    const recorded = await this.one<{ outcome: string }>(
      `select app.record_delivery_sent(${office}, ${lit(claim.delivery_id)}::uuid, ${lit(result.messageRef)}, ${nul(result.link)}) as outcome`,
    )

    return {
      ...base,
      outcome: recorded?.outcome === 'suppressed_too_late' ? 'suppressed_too_late' : 'sent',
      messageRef: result.messageRef,
    }
  }

  /**
   * Reconcile an indeterminate delivery and record the answer.
   *
   * The pair belongs together: reading the channel and then failing to write
   * down what was read leaves the delivery as stuck as before, and the next
   * reconciler pays for the read again.
   *
   * On a channel with no `reconcile`, returns `unreconcilable` and changes
   * nothing. That is not a stub — it is the honest answer, and the delivery
   * stays parked so the message is never sent twice.
   */
  async resolveIndeterminate(request: {
    readonly deliveryId: string
    readonly targetRef: string
    readonly dedupeKey: string
    readonly threadRef?: string | null
    /** The delivery's office. Left out, it is the office the delivery row itself belongs to. */
    readonly officeId?: string | null
  }): Promise<{ readonly resolution: string; readonly messageRef: string | null }> {
    if (this.transport.reconcile === undefined) {
      return { resolution: 'unreconcilable', messageRef: null }
    }

    // A failed read leaves the answer unknown and the row must stay parked.
    // Letting this throw is the point: treating "we could not look" as "it is
    // not there" is how a duplicate gets sent.
    const found = await this.transport.reconcile(
      request.targetRef,
      request.dedupeKey,
      request.threadRef,
    )

    // No job to derive an office from here (this is an operator's reconciliation of a row): the row is the held id, so
    // its own office is the delivery's. An explicit office, when the caller has one, is checked against the row.
    const office =
      request.officeId === undefined || request.officeId === null
        ? `(select d.office_id from public.deliveries d where d.delivery_id = ${lit(request.deliveryId)}::uuid)`
        : `${lit(request.officeId)}::uuid`
    const row = await this.one<{ resolution: string }>(
      `select app.resolve_indeterminate_delivery(${office}, ${lit(request.deliveryId)}::uuid, ${nul(found)}) as resolution`,
    )
    return { resolution: row?.resolution ?? 'unknown', messageRef: found }
  }

  /** Remove a message that should not have been sent. */
  async retract(targetRef: string, messageRef: string): Promise<boolean> {
    if (this.transport.retract === undefined) return false
    return this.transport.retract(targetRef, messageRef)
  }

  /**
   * The SQL expression for the office this request is sent for: the explicit one, else the job's (the claimed job the
   * sender holds), else - for a job-less sender - the test office for a registered test destination or the operator's.
   * Evaluated in the database, once per statement, from rows the sender already holds.
   */
  private officeFor(request: DeliveryRequest): string {
    if (request.officeId !== undefined && request.officeId !== null)
      return `${lit(request.officeId)}::uuid`
    const job =
      request.jobId === null || request.jobId === undefined ? 'null' : `${lit(request.jobId)}::uuid`
    return `app.delivery_office(${job}, ${lit(this.transport.channel)}, ${lit(request.targetRef)}, ${lit(request.dedupeKey)})`
  }

  private async claim(request: DeliveryRequest, office: string): Promise<ClaimRow> {
    const row = await this.one<ClaimRow>(`
      select delivery_id::text as delivery_id, outcome, message_ref, attempt
      from app.claim_delivery(
        ${office},
        ${lit(this.transport.channel)},
        ${lit(request.dedupeKey)},
        ${lit(request.accountRef)},
        ${lit(request.targetRef)},
        ${lit(request.purpose)},
        ${nul(request.threadRef)},
        ${request.staffId === null || request.staffId === undefined ? 'null' : `${lit(request.staffId)}::uuid`},
        ${request.correlationId === null || request.correlationId === undefined ? 'null' : `${lit(request.correlationId)}::uuid`},
        ${request.jobId === null || request.jobId === undefined ? 'null' : `${lit(request.jobId)}::uuid`}
      )
    `)
    if (row === undefined) throw new Error('claim_delivery returned no row')
    return row
  }

  private async recordFailure(
    claim: ClaimRow,
    error: unknown,
    office: string,
  ): Promise<DeliveryResult> {
    if (!(error instanceof TransportError)) throw error

    // `indeterminate` is NOT recorded as retryable. Releasing the lease would
    // invite exactly the second send the transport refused to make. It parks as
    // `failed`, which is terminal and therefore safe, and the only way out is
    // `resolveIndeterminate` — which requires having actually looked.
    const retryable = error.kind === 'retryable'
    await this.db.execute(
      `select app.record_delivery_failure(${office}, ${lit(claim.delivery_id)}::uuid, ${lit(error.code.slice(0, 200))}, ${retryable ? 'true' : 'false'}) as outcome`,
    )

    return {
      outcome: error.kind === 'indeterminate' ? 'indeterminate' : 'failed',
      deliveryId: claim.delivery_id,
      messageRef: null,
      attempt: claim.attempt,
      errorCode: error.code,
    }
  }

  private async one<T>(sql: string): Promise<T | undefined> {
    return (await this.db.execute(sql)).rows[0] as T | undefined
  }
}
