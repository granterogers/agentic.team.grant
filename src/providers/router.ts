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
import type { AllowedModel } from './guards.ts'
import {
  assertModelAllowed,
  assertResponseWasFree,
  buildRequestBody,
  type PaidCallPreventedError,
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

export interface CompletionRequest {
  /** Conversation, in the provider's chat format. */
  readonly messages: readonly { role: string; content: string }[]
  /** Optional explicit model. Omit to take the highest-priority usable one. */
  readonly model?: string
  readonly maxTokens?: number
  /** Ties the call to a job for usage accounting and the ledger. */
  readonly correlationId?: string
}

export interface CompletionResult {
  readonly model: string
  readonly content: string
  readonly promptTokens: number
  readonly completionTokens: number
  /** Always 0 — a non-zero value throws before this is constructed. */
  readonly cost: number
}

interface ProviderRow {
  provider: string
  base_url: string
  free_only: boolean
  secret_ref: string | null
}

/**
 * Reads the allow-list, consults the breaker, calls, verifies, and accounts.
 *
 * The database is passed in rather than imported so tests drive it with a fake
 * executor, and so the same router works over either transport (ADR-0007).
 */
export class ProviderRouter {
  constructor(
    private readonly db: SqlExecutor,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Layer 3's data, read fresh: availability is a measured, expiring fact. */
  private async loadAllowList(): Promise<{ provider: ProviderRow; models: AllowedModel[] }> {
    const { rows } = await this.db.execute(`
      select m.provider, m.model_id, m.pricing_prompt, m.pricing_completion,
             p.base_url, p.free_only, p.secret_ref::text as secret_ref
      from public.usable_models m
      join public.providers p on p.provider = m.provider
      order by p.priority, m.model_id
    `)
    if (rows.length === 0) throw new NoUsableModelError()

    const first = rows[0] as Record<string, unknown>
    return {
      provider: {
        provider: String(first.provider),
        base_url: String(first.base_url),
        free_only: first.free_only === true,
        secret_ref: first.secret_ref === null ? null : String(first.secret_ref),
      },
      models: rows.map((r) => ({
        model_id: String(r.model_id),
        pricing_prompt: r.pricing_prompt === null ? null : String(r.pricing_prompt),
        pricing_completion: r.pricing_completion === null ? null : String(r.pricing_completion),
      })),
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const { provider, models } = await this.loadAllowList()

    // §6: breaker state lives in the database, so a restart does not forget an
    // outage and every worker sees the same breaker.
    const available = await this.db.execute(
      `select app.provider_available('${provider.provider}') as ok`,
    )
    if (available.rows[0]?.ok !== true) throw new ProviderUnavailableError(provider.provider)

    // No explicit model means the highest-priority measured-usable one. There
    // is deliberately no "default model" constant: §4 requires model
    // identifiers to be configuration, and here they are measurement.
    const model = request.model ?? (models[0] as AllowedModel).model_id

    // Layers 1 and 3, before the request exists.
    assertModelAllowed(model, models, provider.free_only)

    const body = buildRequestBody(model, {
      messages: request.messages,
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    })

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
    try {
      const response = await this.fetchImpl(`${provider.base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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
        request.correlationId,
      )
      throw new Error(`provider ${provider.provider} refused: ${message}`)
    }

    // Layer 4. Throwing here rather than absorbing the charge is deliberate: a
    // non-zero cost means an earlier layer was bypassed, which is a defect to
    // surface, not an expense to swallow.
    try {
      assertResponseWasFree(model, payload.usage)
    } catch (error) {
      await this.recordFailure(
        provider.provider,
        (error as PaidCallPreventedError).message.slice(0, 400),
      )
      await this.account(provider.provider, model, 'refused_paid', request.correlationId)
      throw error
    }

    const choice = payload.choices?.[0]
    const content = choice?.message?.content ?? ''

    if (content.trim() === '') {
      // The call succeeded and cost nothing, so this is not a provider failure
      // and must not trip the breaker — the provider did its job. Recording
      // success keeps the breaker honest about availability.
      await this.db.execute(`select app.record_provider_success('${provider.provider}')`)
      await this.account(
        provider.provider,
        payload.model ?? model,
        'empty_completion',
        request.correlationId,
        {
          prompt: payload.usage?.prompt_tokens ?? 0,
          completion: payload.usage?.completion_tokens ?? 0,
        },
      )
      throw new EmptyCompletionError(
        payload.model ?? model,
        choice?.finish_reason ?? 'unknown',
        payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      )
    }

    await this.db.execute(`select app.record_provider_success('${provider.provider}')`)
    await this.account(provider.provider, payload.model ?? model, 'ok', request.correlationId, {
      prompt: payload.usage?.prompt_tokens ?? 0,
      completion: payload.usage?.completion_tokens ?? 0,
    })

    return {
      model: payload.model ?? model,
      content,
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      cost: 0,
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
    correlationId: string | undefined,
    tokens: { prompt: number; completion: number } = { prompt: 0, completion: 0 },
  ): Promise<void> {
    // No correlation id means no job to attribute this to. Recorded anyway,
    // under a generated one: an unattributed call is still a call, and
    // dropping it would make the totals quietly wrong in the direction of
    // "we used less than we did".
    try {
      await recordUsage(this.db, {
        provider,
        modelId,
        correlationId: correlationId ?? crypto.randomUUID(),
        outcome,
        promptTokens: tokens.prompt,
        completionTokens: tokens.completion,
        // OpenRouter's free tier reports no cost, and §11 says that is exactly
        // when a figure must not be called authoritative. `null` carries that.
        providerReportedCost: null,
      })
    } catch {
      // Deliberately swallowed. See the note above.
    }
  }

  private async recordFailure(provider: string, message: string): Promise<void> {
    // §15: redact token patterns before anything reaches stored error text.
    // A provider error frequently carries the URL it was called with.
    const redacted = message
      .replace(/xox[abposr]-[A-Za-z0-9-]+/g, '[REDACTED]')
      .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/sbp_[a-f0-9]+/g, '[REDACTED]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .slice(0, 400)
    await this.db.execute(
      `select app.record_provider_failure('${provider}', '${redacted.replace(/'/g, "''")}')`,
    )
  }
}
