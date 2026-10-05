/**
 * The provider router.
 *
 * §11: *"No ad-hoc provider calls anywhere else in the codebase."* This is the
 * one place an inference request leaves the system, which is what makes the
 * four enforcement layers meaningful — a guard applied in one of two call paths
 * guards nothing.
 *
 * It also owns what §11 requires around the call: circuit-breaker consultation
 * before, usage accounting after, and structured refusal rather than a silent
 * substitution.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { UsageOutcome } from '../inference/policy.ts'
import { recordUsage } from '../inference/record.ts'
import { redactSecrets } from '../text/secrets.ts'
import { extractAnswer, NoAnswerEnvelopeError, withEnvelope } from './envelope.ts'
import type { AllowedModel } from './guards.ts'
import {
  assertModelAllowed,
  assertResponseWithinBudget,
  type Budget,
  buildRequestBody,
  PaidCallPreventedError,
} from './guards.ts'

export class ProviderUnavailableError extends Error {
  constructor(readonly provider: string) {
    super(`provider ${provider} is unavailable: its circuit breaker is open`)
    this.name = 'ProviderUnavailableError'
  }
}

/**
 * The model produced no content.
 *
 * Distinct from a provider error, because the call succeeded and cost nothing —
 * it simply returned nothing usable. Measured cause, 2026-09-03: every free
 * model on this tier is a **reasoning** model, and reasoning tokens are drawn
 * from the same completion budget. A request with `max_tokens: 8` spent all
 * eight on hidden reasoning and returned `content: null` with
 * `finish_reason: "length"`.
 *
 * This must not be returned as an empty string. §10 requires an explicit
 * failure state for output that triggers further machine action, and a blank
 * string would pass quality review as vacuous content rather than failing.
 */
export class EmptyCompletionError extends Error {
  constructor(
    readonly model: string,
    readonly finishReason: string,
    readonly reasoningTokens: number,
  ) {
    super(
      `${model} returned no content (finish_reason=${finishReason}` +
        (reasoningTokens > 0
          ? `, ${reasoningTokens} tokens spent on reasoning — raise maxTokens above the reasoning budget`
          : '') +
        ')',
    )
    this.name = 'EmptyCompletionError'
  }
}

export class NoUsableModelError extends Error {
  constructor() {
    super(
      'no model is currently measured as usable. Run `npm run providers:discover`; ' +
        'if it still finds none, every free endpoint is refusing us and work must queue (§11).',
    )
    this.name = 'NoUsableModelError'
  }
}

/**
 * Every candidate was tried and every one failed.
 *
 * Carries the models it tried, in order, because "inference failed" is not an
 * actionable sentence and "these three were tried, the last said 429" is. The
 * final failure is kept as `cause` rather than flattened into the message, so
 * a caller that wants to distinguish an empty completion from a rate limit
 * still can.
 */
export class AllCandidatesFailedError extends Error {
  constructor(
    readonly candidates: readonly string[],
    override readonly cause: Error,
  ) {
    super(
      `all ${String(candidates.length)} candidate model(s) failed ` +
        `(${candidates.join(', ')}); last: ${cause.message.slice(0, 200)}`,
    )
    this.name = 'AllCandidatesFailedError'
  }
}

export interface CompletionRequest {
  /** Conversation, in the provider's chat format. */
  readonly messages: readonly { role: string; content: string }[]
  /** Optional explicit model. Omit to take the highest-priority usable one. */
  readonly model?: string
  readonly maxTokens?: number
  /**
   * Sampling temperature, when the caller needs the SAME answer twice.
   *
   * Omitted for ordinary work — the office is not trying to be deterministic
   * when it writes to Grant, and pinning it there would make every reply
   * flatter for no benefit.
   *
   * `npm run eval` sets it to 0, and that is not a preference. A judge left at
   * the provider default gave 17/19 and then 16/19 on an UNCHANGED corpus with
   * different cases disagreeing each run, which is the same defect as 0361's
   * random tiebreak wearing a different hat: a number that changes when nothing
   * under test changed is not a measurement. The router already pins the judge
   * MODEL for exactly this reason and stopped one step short.
   */
  readonly temperature?: number
  /**
   * Ask for the reply inside an answer envelope and return ONLY what is inside it (#412, src/providers/envelope.ts).
   * Anything the model wrote outside the tags is dropped, and a reply with no usable envelope is not an answer: the call
   * fails over to the next model like any other unusable reply. Off unless a caller asks, and no production caller does
   * until the canary has measured compliance (docs/testing/answer-envelope-canary.md).
   */
  readonly answerEnvelope?: boolean
  /** Ties the call to a job for usage accounting and the ledger. */
  readonly correlationId?: string
  /**
   * The job this call is being made for.
   *
   * Separate from `correlationId` because they answer different questions. A
   * correlation id is a THREAD — a parent job and every child it spawns share
   * one, so it says "which conversation", never "which piece of work". Cost
   * per outcome needs the second, and until this field existed the only
   * writers that filled `inference_usage.job_id` were two avatar scripts
   * passing it by hand: 49 rows out of 172, none of them from the worker.
   * A column that exists, is read, and is never written by the production
   * path is the same defect shape as `outputs.staff_id` was.
   */
  readonly jobId?: string
}

export interface CompletionResult {
  readonly model: string
  readonly content: string
  readonly promptTokens: number
  readonly completionTokens: number
  /**
   * What the provider reported for this response, in US dollars.
   *
   * Zero on a free model, and zero is no longer the only legal value: a cost
   * ABOVE the provider's per-call ceiling throws before this is constructed,
   * a cost below it is recorded. Reporting it as 0 while a funded key was
   * charged would be the same defect as a column that can only ever say one
   * thing.
   */
  readonly cost: number
}

interface ProviderRow {
  provider: string
  base_url: string
  free_only: boolean
  secret_ref: string | null
  /**
   * What this provider may charge, straight off its registry row.
   *
   * Carried on the provider rather than the model because it is a statement
   * about what Grant has funded, not about what a model happens to cost — a
   * new model appearing in the allow-list must not arrive with its own
   * permission to spend.
   */
  budget: Budget
}

/**
 * Reads the allow-list, consults the breaker, calls, verifies, and accounts.
 *
 * The database is passed in rather than imported so tests drive it with a fake
 * executor, and so the same router works over either transport (ADR-0007).
 */
/** How many different models one request may be tried against. */
export const DEFAULT_MAX_ATTEMPTS = 3

export class ProviderRouter {
  private readonly maxAttempts: number
  /**
   * The key, once resolved from the vault.
   *
   * `providers.secret_ref` has existed since the registry did, was loaded into
   * `ProviderRow` on every call, and was never read — the constructor's key won
   * unconditionally. So the only way to give a worker a key was an environment
   * variable, and §15 says secrets live in the vault. Cached per instance
   * because one drain resolves it once and then makes up to three calls.
   */
  private resolved: string | null = null

  constructor(
    private readonly db: SqlExecutor,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    // Bounded, and bounded low. Every attempt is a real request to a real
    // provider, and a router that walks the whole registry on a bad afternoon
    // turns one slow job into thirty seconds of requests nobody asked for.
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {
    this.maxAttempts = Math.max(1, maxAttempts)
  }

  /**
   * Layer 3's data, read fresh: availability is a measured, expiring fact —
   * and, since #127, so is competence.
   *
   * `app.model_order` (0394) returns the allow-list already in the order to
   * try it, each row carrying the reason. The order is NOT restated here, and
   * that is the point: the previous version of this method restated the view's
   * `ORDER BY` because a view's ordering does not survive being selected from,
   * and the two copies then disagreed — `model_priority` was added to one and
   * not the other, which sent the first real paid request to three free models
   * instead. One list assembled once, by the thing that knows why.
   *
   * The kind is read from the job rather than passed in, so it cannot be
   * passed WRONGLY and no caller has to be changed to get it right. A call
   * with no job is not given a false kind: `(unattributed)` is what the record
   * itself calls those rows, and it is a real record of real calls.
   */
  private async loadAllowList(
    jobId?: string,
  ): Promise<{ provider: ProviderRow; models: AllowedModel[]; why: Map<string, string> }> {
    // raw-sql[2]: keyed by the claimed job; it reads one column (the kind) of the job the caller holds.
    const forJob =
      jobId === undefined || jobId === ''
        ? `'(unattributed)'`
        : `coalesce((select j.kind from public.jobs j where j.job_id = '${jobId.replace(/'/g, "''")}'::uuid), '(unattributed)')`
    const { rows } = await this.db.execute(`
      select o.provider, o.model_id, o.pricing_prompt, o.pricing_completion,
             o.base_url, o.secret_ref::text as secret_ref, o.standing, o.why,
             p.free_only,
             p.max_price_prompt, p.max_price_completion, p.max_cost_per_call_usd
      from app.model_order(${forJob}) o
      join public.providers p on p.provider = o.provider
    `)
    if (rows.length === 0) throw new NoUsableModelError()

    const first = rows[0] as Record<string, unknown>
    return {
      provider: {
        provider: String(first.provider),
        base_url: String(first.base_url),
        free_only: first.free_only === true,
        secret_ref: first.secret_ref === null ? null : String(first.secret_ref),
        budget: {
          maxPricePrompt: Number(first.max_price_prompt ?? 0),
          maxPriceCompletion: Number(first.max_price_completion ?? 0),
          maxCostPerCallUsd: Number(first.max_cost_per_call_usd ?? 0),
        },
      },
      models: rows.map((r) => ({
        model_id: String(r.model_id),
        pricing_prompt: r.pricing_prompt === null ? null : String(r.pricing_prompt),
        pricing_completion: r.pricing_completion === null ? null : String(r.pricing_completion),
      })),
      why: new Map(rows.map((r) => [String(r.model_id), String(r.why ?? '')])),
    }
  }

  /**
   * Say, in the job's own trace, which model was chosen and on what evidence.
   *
   * #127's last acceptance criterion — *"the router explains its choice in the
   * trace"* — and it is written from the SAME row the order came from, so the
   * explanation cannot drift from the decision it explains.
   *
   * Never allowed to fail the call. A trace is bookkeeping and the work is the
   * work; but it is not swallowed silently either, because a write nobody
   * reads back is indistinguishable from a feature that was never built. It
   * fails into the console, which is where a worker's faults are read.
   */
  private async explainChoice(
    jobId: string | undefined,
    model: string,
    why: string,
  ): Promise<void> {
    if (jobId === undefined || jobId === '' || why === '') return
    const detail = JSON.stringify({ chose: model, because: why }).replace(/'/g, "''")
    await this.db
      .execute(
        `select app.job_trace_add(app.job_office('${jobId.replace(/'/g, "''")}'::uuid), '${jobId.replace(/'/g, "''")}'::uuid, 'decision',
           '${detail}'::jsonb, null, null, null, null)`,
      )
      .catch((error: unknown) => {
        console.error(
          `router: could not trace the model choice — ${String((error as Error).message)}`,
        )
      })
  }

  /**
   * The key to present, preferring the vault over the environment.
   *
   * The environment still wins when the vault holds nothing, because a local
   * run with `OPENROUTER_API_KEY` set should keep working and because the
   * verification suites pass a fixture key directly.
   */
  private async key(provider: ProviderRow): Promise<string> {
    if (this.resolved !== null) return this.resolved
    if (provider.secret_ref !== null) {
      const { rows } = await this.db.execute(
        `select app.resolve_secret('${provider.secret_ref.replace(/'/g, "''")}'::app.vault_secret_ref) as k`,
      )
      const fromVault = (rows[0] as { k?: string | null } | undefined)?.k
      if (fromVault !== null && fromVault !== undefined && fromVault !== '') {
        this.resolved = fromVault
        return fromVault
      }
    }
    this.resolved = this.apiKey
    return this.apiKey
  }

  /**
   * Complete a request, failing over between measured-usable models.
   *
   * ## Why failover, and why only here
   *
   * Until 2026-09-06 this made exactly one attempt at exactly one model. On a
   * paid tier that is defensible; on the free tier it is not, because a free
   * endpoint's normal state includes being rate-limited. One 429 from the
   * top-priority model failed the whole job, and the registry recorded four
   * other models as usable at that moment.
   *
   * Failover is **not** a retry loop. The same model is never tried twice: if
   * it is rate-limited, waiting is what a rate limit means and hammering it is
   * how a temporary limit becomes a longer one. Each candidate is a different
   * model, tried once, in the priority order measurement produced.
   *
   * ## What it deliberately does NOT fail over on
   *
   * - **A paid response** (`PaidCallPreventedError`). §11's whole point. A
   *   model that charged us is a defect in the allow-list, and moving on to
   *   the next model would hide it behind a success.
   * - **An open breaker** (`ProviderUnavailableError`). That is a statement
   *   about the provider, not the model, and every candidate shares it.
   * - **A caller-named model.** `request.model` is a decision someone made;
   *   silently answering with a different model would make the recorded
   *   provenance a lie.
   */
  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const { provider, models, why } = await this.loadAllowList(request.jobId)

    // A named model is honoured exactly, or it fails. See above.
    if (request.model !== undefined) {
      return this.attempt(provider, models, request, request.model)
    }

    const candidates = models.slice(0, this.maxAttempts).map((m) => m.model_id)
    let lastError: Error = new NoUsableModelError()

    for (const [index, model] of candidates.entries()) {
      try {
        const result = await this.attempt(provider, models, request, model)
        // Traced after it worked, not before it was tried: the interesting
        // fact is which model ANSWERED, and a model that threw and was failed
        // over from is already recorded in `inference_usage` with its outcome.
        await this.explainChoice(request.jobId, model, why.get(model) ?? '')
        return result
      } catch (error) {
        // Non-negotiable: these end the call rather than advancing it.
        // `PaidCallPreventedError` covers both "this model is not on the
        // allow-list" and "the response was charged for". Neither is a reason
        // to try another model: the first says the registry is wrong and the
        // second says a guard was bypassed, and moving on would hide either
        // behind a success.
        if (error instanceof PaidCallPreventedError) throw error
        if (error instanceof ProviderUnavailableError) throw error
        lastError = error as Error
        if (index === candidates.length - 1) break
      }
    }

    // One candidate is not a failover, so it does not get a failover's error.
    // Wrapping a lone `EmptyCompletionError` in "all 1 candidate(s) failed"
    // would cost every caller the ability to tell an empty completion from a
    // rate limit, in exchange for no information at all.
    if (candidates.length <= 1) throw lastError
    throw new AllCandidatesFailedError(candidates, lastError)
  }

  private async attempt(
    provider: ProviderRow,
    models: AllowedModel[],
    request: CompletionRequest,
    chosenModel: string,
  ): Promise<CompletionResult> {
    // §6: breaker state lives in the database, so a restart does not forget an
    // outage and every worker sees the same breaker.
    const available = await this.db.execute(
      `select app.provider_available('${provider.provider}') as ok`,
    )
    if (available.rows[0]?.ok !== true) throw new ProviderUnavailableError(provider.provider)

    // Chosen by the caller above: either the model they named, or the next
    // candidate in the priority order measurement produced. There is
    // deliberately no "default model" constant — §4 requires model identifiers
    // to be configuration, and here they are measurement.
    const model = chosenModel

    // Layers 1 and 3, before the request exists.
    assertModelAllowed(model, models, provider.free_only)

    const body = buildRequestBody(
      model,
      {
        messages:
          request.answerEnvelope === true ? withEnvelope(request.messages) : request.messages,
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      },
      provider.budget,
    )

    // `response.json()` is `unknown`, correctly: the provider's response is
    // untrusted input. Named so the assertion happens once, here, rather than
    // being spread through property accesses.
    type ProviderResponse = {
      error?: { code?: number; message?: string }
      model?: string
      choices?: {
        finish_reason?: string
        // `reasoning` and `reasoning_details` are deliberately NOT declared.
        // §6 forbids storing or exposing chain-of-thought, and the surest way
        // to honour that is for the type to have no field to put it in — a
        // property that does not exist cannot be forwarded by accident.
        message?: { content?: string | null }
      }[]
      usage?: {
        cost?: number | null
        prompt_tokens?: number
        completion_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    }
    let payload: ProviderResponse
    let startedAt = Date.now()
    try {
      // The clock starts here and not a line earlier: what is being measured
      // is how long the provider takes, not how long this function takes to
      // resolve a key. `app.model_speed` reads the result and it is the basis
      // for any future "which model answers Grant" decision (0150).
      startedAt = Date.now()
      const response = await this.fetchImpl(`${provider.base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.key(provider)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      payload = (await response.json()) as ProviderResponse
    } catch (error) {
      await this.recordFailure(provider.provider, (error as Error).message)
      throw error
    }

    if (payload.error !== undefined) {
      const message = `${String(payload.error.code)} ${payload.error.message ?? ''}`
      await this.recordFailure(provider.provider, message)
      await this.account(
        provider.provider,
        model,
        String(payload.error.code) === '429' ? 'rate_limited' : 'provider_error',
        request,
      )
      throw new Error(`provider ${provider.provider} refused: ${message}`)
    }

    // Layer 4. Throwing here rather than absorbing the charge is deliberate: a
    // cost above the provider's ceiling means an earlier layer was bypassed,
    // which is a defect to surface, not an expense to swallow.
    try {
      assertResponseWithinBudget(model, payload.usage, provider.budget.maxCostPerCallUsd)
    } catch (error) {
      await this.recordFailure(
        provider.provider,
        (error as PaidCallPreventedError).message.slice(0, 400),
      )
      await this.account(provider.provider, model, 'refused_paid', request)
      throw error
    }

    const choice = payload.choices?.[0]
    const content = choice?.message?.content ?? ''

    if (content.trim() === '') {
      // The call succeeded, so this is not a provider failure and must not trip
      // the breaker — the provider did its job. Recording success keeps the
      // breaker honest about availability. On a funded key it did cost
      // something, which is exactly why the charge is accounted below rather
      // than dropped: an answer we could not use is the expensive kind.
      await this.db.execute(`select app.record_provider_success('${provider.provider}')`)
      await this.account(
        provider.provider,
        payload.model ?? model,
        'empty_completion',
        request,
        {
          prompt: payload.usage?.prompt_tokens ?? 0,
          completion: payload.usage?.completion_tokens ?? 0,
        },
        Date.now() - startedAt,
        payload.usage?.cost ?? 0,
      )
      throw new EmptyCompletionError(
        payload.model ?? model,
        choice?.finish_reason ?? 'unknown',
        payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      )
    }

    await this.db.execute(`select app.record_provider_success('${provider.provider}')`)
    const costUsd = payload.usage?.cost ?? 0

    // The envelope, when asked for: only what is inside it is the reply. A reply without one is not an answer, so the
    // attempt is recorded as a malformed response (the call did happen and may have been charged) and the caller's failover
    // moves on. The breaker is not touched: the provider did its job, the MODEL did not follow the format.
    let delivered = content
    if (request.answerEnvelope === true) {
      const found = extractAnswer(content)
      if (!found.ok) {
        await this.account(
          provider.provider,
          payload.model ?? model,
          'malformed_response',
          request,
          {
            prompt: payload.usage?.prompt_tokens ?? 0,
            completion: payload.usage?.completion_tokens ?? 0,
          },
          Date.now() - startedAt,
          costUsd,
        )
        throw new NoAnswerEnvelopeError(payload.model ?? model, found.reason)
      }
      delivered = found.answer
    }
    await this.account(
      provider.provider,
      payload.model ?? model,
      'ok',
      request,
      {
        prompt: payload.usage?.prompt_tokens ?? 0,
        completion: payload.usage?.completion_tokens ?? 0,
      },
      Date.now() - startedAt,
      costUsd,
    )

    return {
      model: payload.model ?? model,
      content: delivered,
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      cost: costUsd,
    }
  }

  /**
   * Write the §11 usage row.
   *
   * This was missing entirely until a worker running a real job through the
   * whole pipeline reported zero recorded calls. §11 requires every inference
   * attempt to be accounted for, failures included - and the router is the one
   * place every call passes through, so anywhere else is the wrong place. The
   * only caller of `recordUsage` was a POC script doing it by hand, which is
   * how a rule that reads as enforced becomes a rule one script happens to
   * follow.
   *
   * Never throws. A usage row that fails to write must not turn a successful
   * completion into an error - the accounting is important, and it is not more
   * important than the work.
   */
  private async account(
    provider: string,
    modelId: string,
    outcome: UsageOutcome,
    request: Pick<CompletionRequest, 'correlationId' | 'jobId'>,
    tokens: { prompt: number; completion: number } = { prompt: 0, completion: 0 },
    latencyMs?: number,
    costUsd: number | null = null,
  ): Promise<void> {
    // No correlation id means no job to attribute this to. Recorded anyway,
    // under a generated one: an unattributed call is still a call, and
    // dropping it would make the totals quietly wrong in the direction of
    // "we used less than we did".
    try {
      await recordUsage(this.db, {
        provider,
        modelId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        jobId: request.jobId,
        outcome,
        promptTokens: tokens.prompt,
        completionTokens: tokens.completion,
        // `null` where the provider reported nothing — §11 says an unreported
        // figure must not be called authoritative, and null carries that. On a
        // funded key the provider DOES report, and passing the real number is
        // what makes `inference_usage` able to answer what a day costs. It was
        // hardcoded null while every model was free, which is a column that
        // could only ever say one thing.
        providerReportedCost: costUsd,
        latencyMs,
      })
    } catch {
      // Deliberately swallowed. See the note above.
    }
  }

  private async recordFailure(provider: string, message: string): Promise<void> {
    /*
      §15: redact token patterns before anything reaches stored error text. A
      provider error frequently carries the URL it was called with.

      This was four patterns written inline here. It is now the shared list in
      `src/text/secrets.ts`, because there were three separate vocabularies in
      this repository — this one, the Telegram URL redactor, and the CHECK
      constraint on `connection_health` — and each was missing what the others
      had. This one had never heard of a Notion token, a GitHub PAT or a Google
      refresh token, all three of which the office holds.

      A redaction list in three places is a redaction list that is wrong in at
      least two of them, and it fails silently: what you find out is that a
      credential was stored, and you find it out late.
    */
    const redacted = redactSecrets(message).slice(0, 400)
    await this.db.execute(
      `select app.record_provider_failure('${provider}', '${redacted.replace(/'/g, "''")}')`,
    )
  }
}
