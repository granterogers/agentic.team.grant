/**
 * The bridge: claims one office run at a time, hands it to the Hermes on this machine, watches it, and reports how it ended
 * (INTERFACE-CONTRACTS section 5.2). Outbound only: it calls the office's engine gateway and the local Hermes API and nothing else.
 *
 * What it guarantees, each with a test and a sabotage:
 *   - ONE run at a time, and only a run the gateway handed it (the office is the credential's, never named here);
 *   - the idempotency key is PER ATTEMPT (`engine-run-<run>-<claim>`), because after a Hermes restart the same key replays a dead run;
 *   - a live Hermes run is re-attached by its id, never re-started; an earlier attempt's run is stopped first;
 *   - CONTAINMENT: a tool Hermes reports that is not one of the office's read tools stops the run (`containment: <tool>`);
 *   - an approval request is always denied, and counted;
 *   - the office's Stop reaches Hermes through the heartbeat, and a run with no event for `no_progress` seconds is stopped
 *     (Hermes retries a provider 500 for ever), as is one past its deadline;
 *   - the answer, the failure sentence and every size it sends are bounded, and nothing it logs holds a body or a credential.
 */
import { rm } from 'node:fs/promises'
import { convertSkill } from '../../src/engines/hermes/skills.ts'
import {
  ENGINE_READ_TOOLS,
  HEARTBEAT_S,
  LIMITS,
  NO_PROGRESS_S,
  POLL_IDLE_S,
  POLL_QUIET_AFTER_S,
  POLL_QUIET_S,
  STOP_WAIT_S,
} from '../../src/engines/hermes/timing.ts'
import {
  type BridgeConfig,
  type ClaimedRun,
  type EngineOutcome,
  type EngineRunResult,
  resultProblem,
} from '../../src/engines/hermes/types.ts'
import type { GatewayClient } from './gateway-client.ts'
import type { HermesClient, RunStatus } from './hermes-client.ts'
import { clearExport, emptyDir, harvestDrafts, writeExport } from './skills-sync.ts'
import type { SseEvent } from './sse.ts'

export const BRIDGE_VERSION = '0.1.0'

export interface Timing {
  readonly heartbeatMs: number
  readonly noProgressMs: number
  readonly stopWaitMs: number
  readonly deadlineGraceMs: number
  /** A bridge that has not had a heartbeat accepted for this long has lost its lease and gives the run up. */
  readonly leaseGiveUpMs: number
  readonly finishRetryMs: number
  readonly finishGiveUpMs: number
  readonly preflightEveryMs: number
  readonly pollIdleMs: number
  readonly pollQuietMs: number
  readonly quietAfterMs: number
  readonly reconnects: number
  readonly reconnectDelayMs: number
  readonly tickMs: number
}

export const DEFAULT_TIMING: Timing = {
  heartbeatMs: HEARTBEAT_S * 1000,
  noProgressMs: NO_PROGRESS_S * 1000,
  stopWaitMs: STOP_WAIT_S * 1000,
  deadlineGraceMs: 30_000,
  leaseGiveUpMs: 80_000,
  finishRetryMs: 5_000,
  finishGiveUpMs: 60_000,
  preflightEveryMs: 600_000,
  pollIdleMs: POLL_IDLE_S * 1000,
  pollQuietMs: POLL_QUIET_S * 1000,
  quietAfterMs: POLL_QUIET_AFTER_S * 1000,
  reconnects: 5,
  reconnectDelayMs: 500,
  tickMs: 200,
}

/** How long to wait before asking the gateway again, given how long it has been idle. Pure, so the schedule is a test. */
export const idleDelay = (
  idleForMs: number,
  timing: Pick<Timing, 'pollIdleMs' | 'pollQuietMs' | 'quietAfterMs'>,
): number => (idleForMs >= timing.quietAfterMs ? timing.pollQuietMs : timing.pollIdleMs)

export interface BridgeDeps {
  readonly hermes: HermesClient
  readonly gateway: GatewayClient
  readonly config: BridgeConfig
  /**
   * Skill learning (M8b), absent unless the host configured it. `hermes` is the client for the learning profile; a learning run is run on
   * it. Without it a run the office marked as a learning run is run on the ordinary profile and nothing is harvested.
   */
  readonly learning?: { readonly hermes: HermesClient; readonly settleMs?: number }
  readonly timing?: Partial<Timing>
  /** One line, never a body or a credential. */
  readonly log?: (line: string) => void
  readonly now?: () => number
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface Ended {
  /** How the run ended, or `abandoned` when the claim was lost and nothing was reported. */
  readonly outcome: EngineOutcome | 'abandoned'
  /** Whether the gateway accepted the report. */
  readonly sent: boolean
  readonly reason: string
}

type Verdict =
  | { readonly outcome: 'failed'; readonly failure: string }
  | { readonly outcome: 'cancelled' }

interface Terminal {
  readonly event: string
  readonly status: RunStatus | null
  readonly data: Record<string, unknown>
}

const realSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted === true) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })

/** The run's request, serialised with sorted keys so every claim of the same run sends byte-identical bytes. */
export const canonicalBody = (request: unknown, sessionId: string): string => {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : typeof v === 'object' && v !== null
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v
  return JSON.stringify(sort({ ...(request as Record<string, unknown>), session_id: sessionId }))
}

/** A tool name Hermes reported, made safe to put in a sentence and a log line. */
const safeName = (value: unknown): string =>
  String(value ?? '')
    .replace(/[^A-Za-z0-9_.:-]/g, '?')
    .slice(0, 60)

/** A sentence the office wrote, made safe for a log line: printable ASCII only (a refusal can echo a field name a model chose), bounded. */
const plainLine = (value: unknown): string =>
  String(value ?? '')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, 160)

const HERMES_ID = /^run_[0-9a-f]{32}$/

export class Bridge {
  readonly timing: Timing
  private readonly hermes: HermesClient
  private readonly gateway: GatewayClient
  private readonly config: BridgeConfig
  private readonly learning: BridgeDeps['learning']
  private readonly log: (line: string) => void
  private readonly now: () => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private preflightAt = 0
  private preflightOk = { hermes_ok: false, toolsets_ok: false }

  constructor(deps: BridgeDeps) {
    this.timing = { ...DEFAULT_TIMING, ...(deps.timing ?? {}) }
    this.hermes = deps.hermes
    this.gateway = deps.gateway
    this.config = deps.config
    this.learning = deps.learning
    this.log = deps.log ?? (() => undefined)
    this.now = deps.now ?? (() => Date.now())
    this.sleep = deps.sleep ?? realSleep
  }

  /** The three checks of section 5.1. A failure is reported in the claim, so the gateway records the bridge as not ready. */
  async preflight(): Promise<{ hermes_ok: boolean; toolsets_ok: boolean }> {
    const healthy = await this.hermes.healthy()
    const capable = healthy && (await this.hermes.capable())
    const enabled = healthy ? await this.hermes.enabledToolsets() : null
    // Only the office's own MCP server may be an enabled toolset; anything else (a terminal, files, the web ...) fails closed,
    // and so does a toolset list that could not be read at all.
    // biome-ignore lint/complexity/useOptionalChain: an unreadable list must be the boolean false, and `enabled?.every` would be undefined
    const toolsets = enabled !== null && enabled.every((name) => name === 'office')
    this.preflightOk = { hermes_ok: healthy && capable, toolsets_ok: toolsets }
    this.preflightAt = this.now()
    if (!this.preflightOk.hermes_ok || !this.preflightOk.toolsets_ok)
      this.log(
        `preflight failed: hermes_ok=${String(this.preflightOk.hermes_ok)} toolsets_ok=${String(this.preflightOk.toolsets_ok)}`,
      )
    return this.preflightOk
  }

  /** One poll: preflight when due, claim, and run what is handed over. Returns what to wait before the next poll (ms). */
  async pollOnce(): Promise<{ waitMs: number; ran: Ended | null; fatal: string | null }> {
    const stale = this.now() - this.preflightAt >= this.timing.preflightEveryMs
    const failing = !this.preflightOk.hermes_ok || !this.preflightOk.toolsets_ok
    const flags = stale || failing ? await this.preflight() : this.preflightOk
    const claim = await this.gateway.claim({ bridge_version: BRIDGE_VERSION, ...flags })
    if (!claim.ok) {
      if (claim.error.kind === 'unauthorized')
        return {
          waitMs: this.timing.pollQuietMs,
          ran: null,
          fatal: 'the gateway does not recognise this bridge token (retired or wrong)',
        }
      const wait =
        claim.error.kind === 'unavailable' || claim.error.kind === 'rate_limited'
          ? Math.max(this.timing.pollIdleMs, claim.error.retryAfterS * 1000)
          : this.timing.pollIdleMs
      this.log(`claim failed: ${claim.error.kind}`)
      return { waitMs: wait, ran: null, fatal: null }
    }
    const run = claim.value.run
    if (run === null || run === undefined)
      return { waitMs: Math.max(0, claim.value.poll_after_s * 1000), ran: null, fatal: null }
    const ran = await this.runClaimed(run)
    return { waitMs: 0, ran, fatal: null }
  }

  /** Poll until `signal` aborts or the gateway refuses the token. Idle polls back off from 15 s to 60 s after ten idle minutes. */
  async serve(signal: AbortSignal): Promise<string | null> {
    let idleSince = this.now()
    while (!signal.aborted) {
      const r = await this.pollOnce()
      if (r.fatal !== null) return r.fatal
      if (r.ran !== null) {
        idleSince = this.now()
        continue
      }
      // The gateway's own hint (an unhealthy bridge is told 60 s, a failing gateway its retry-after) and the idle schedule: the longer wins.
      await this.sleep(Math.max(r.waitMs, idleDelay(this.now() - idleSince, this.timing)), signal)
    }
    return null
  }

  /** Run one claimed run to its end and report it. Never throws: a failure of the bridge itself is a failed run, said plainly. */
  async runClaimed(run: ClaimedRun): Promise<Ended> {
    let ended: Ended
    try {
      // Skills are prepared before Hermes starts and, if they cannot be made safe, the run does not start: a stale reference skill
      // (one withdrawn since) is never the fallback.
      await this.prepareSkills(run)
      ended = await this.drive(run)
    } catch (error) {
      this.log(`run ${run.run_id}: the bridge failed: ${safeName((error as Error)?.message)}`)
      ended = await this.finish(
        run,
        'failed',
        { failure: 'the bridge hit an error', tools_started: 0, approvals_denied: 0 },
        'bridge_error',
      )
    }
    await this.afterRun(run, ended)
    return ended
  }

  /** Whether the office opened this run to learn from. Only the office says so (the claim carries it); nothing here can switch it on. */
  private learns(run: ClaimedRun): boolean {
    return run.profile === 'hermes-learn' && this.learning !== undefined
  }

  /** The Hermes client for a run: the learning profile's for a learning run, else the ordinary one. */
  private hermesFor(run: ClaimedRun): HermesClient {
    return this.learns(run) && this.learning !== undefined ? this.learning.hermes : this.hermes
  }

  /**
   * Before Hermes starts: empty the learning run's own directory, and replace the read-only reference directory with the office's live
   * skills for this run (a learning run) or with nothing (any other run). A re-attach to a Hermes run already started is left alone: the
   * run's own directory is its work in progress.
   */
  private async prepareSkills(run: ClaimedRun): Promise<void> {
    const { learnDir, skillsExportDir } = this.config
    if (run.hermes_run_id !== null) return
    if (learnDir !== undefined && this.learns(run)) await emptyDir(learnDir)
    if (skillsExportDir === undefined) return
    if (!this.learns(run)) {
      await clearExport(skillsExportDir)
      return
    }
    const got = await this.gateway.skills(run.run_id)
    if (!got.ok) {
      await clearExport(skillsExportDir)
      this.log(
        `run ${run.run_id}: the office's skills could not be read (${got.error.kind}); the reference directory was emptied`,
      )
      return
    }
    const n = await writeExport(skillsExportDir, got.value.skills)
    this.log(
      `run ${run.run_id}: ${String(n)} approved skill(s) offered to Hermes as read-only reference`,
    )
  }

  /**
   * After a learning run: give the office whatever skills Hermes wrote, as PROPOSALS (at most three), and delete the directory whatever
   * happened. The run's answer was reported before this starts, so nothing here can delay or change it. A proposal the office refuses is
   * logged with the office's own sentence and is not retried.
   */
  private async afterRun(run: ClaimedRun, ended: Ended): Promise<void> {
    const { learnDir } = this.config
    if (learnDir === undefined || !this.learns(run)) return
    try {
      if (ended.outcome === 'completed' && ended.sent) {
        await this.sleep(this.learning?.settleMs ?? 5_000)
        for (const draft of await harvestDrafts(learnDir)) {
          const converted = convertSkill(draft)
          if (!converted.ok) {
            this.log(
              `run ${run.run_id}: a skill Hermes wrote was not proposed (${plainLine(converted.reason)})`,
            )
            continue
          }
          const sent = await this.gateway.proposeSkill({
            run_id: run.run_id,
            skill: converted.offer,
          })
          this.log(
            sent.ok
              ? sent.value.ok
                ? `run ${run.run_id}: proposed a skill for a person to read`
                : `run ${run.run_id}: the office did not take a skill (${plainLine(sent.value.refused ?? 'refused')})`
              : `run ${run.run_id}: a skill could not be proposed (${sent.error.kind})`,
          )
        }
      }
    } catch (error) {
      this.log(
        `run ${run.run_id}: harvesting skills failed: ${safeName((error as Error)?.message)}`,
      )
    } finally {
      await rm(learnDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async drive(run: ClaimedRun): Promise<Ended> {
    const t = this.timing
    const key = `engine-run-${run.run_id}-${String(run.claim_gen)}`
    const state = {
      hermesRunId: run.hermes_run_id as string | null,
      events: 0,
      tools: 0,
      denied: 0,
      lastEvent: 'none',
      lastEventAt: this.now(),
      lastSeq: -1,
      lastBeatOkAt: this.now(),
      notes: [] as string[],
      terminal: null as Terminal | null,
      verdict: null as Verdict | null,
      verdictAt: 0,
      stopSent: false,
      officeStopped: false,
      abandoned: false,
    }
    const ac = new AbortController()
    const hermes = this.hermesFor(run)

    // An earlier attempt's Hermes run is stopped before this attempt starts (its key would replay a dead run).
    if (run.previous_hermes_run_id !== null) await hermes.stop(run.previous_hermes_run_id)

    if (state.hermesRunId === null) {
      let started: Awaited<ReturnType<HermesClient['startRun']>>
      try {
        started = await hermes.startRun(canonicalBody(run.request, run.run_id), key)
      } catch {
        return this.finish(
          run,
          'failed',
          { failure: 'hermes_unreachable', tools_started: 0, approvals_denied: 0 },
          'hermes_unreachable',
        )
      }
      if (started.status === 409)
        return this.finish(
          run,
          'failed',
          { failure: 'idempotency_conflict', tools_started: 0, approvals_denied: 0 },
          'idempotency_conflict',
        )
      if (started.status === 429)
        return this.finish(
          run,
          'failed',
          { failure: 'hermes_busy', tools_started: 0, approvals_denied: 0 },
          'hermes_busy',
        )
      if (started.status !== 202 || started.runId === null || !HERMES_ID.test(started.runId))
        return this.finish(
          run,
          'failed',
          {
            failure: `hermes_refused_${String(started.status)}`,
            tools_started: 0,
            approvals_denied: 0,
          },
          'hermes_refused',
        )
      state.hermesRunId = started.runId
    }
    const hermesRunId = state.hermesRunId
    this.log(`run ${run.run_id}: attempt ${String(run.claim_gen)} is Hermes run ${hermesRunId}`)

    // The stop is sent without making the loop wait for it, but the run is not over until it has gone: a bridge that returned first would
    // poll for the next run while the last one still held Hermes's only slot (and a test could not see the stop it asked for).
    let stopping: Promise<void> | null = null
    const stopHermes = async (): Promise<void> => {
      if (state.stopSent) return
      state.stopSent = true
      stopping = hermes.stop(hermesRunId)
      await stopping
    }
    const decide = (v: Verdict): void => {
      if (state.verdict === null) {
        state.verdict = v
        state.verdictAt = this.now()
        void stopHermes()
      }
    }
    const handle = (ev: SseEvent): void => {
      state.events += 1
      state.lastEventAt = this.now()
      if (ev.id !== null) state.lastSeq = ev.id
      const data = ev.data ?? {}
      const name = typeof data.event === 'string' ? data.event : 'unknown'
      state.lastEvent = name.slice(0, 60)
      if (name === 'tool.started') {
        state.tools += 1
        const tool = String(data.tool ?? data.name ?? '')
        const ok =
          tool.startsWith(this.config.officeToolPrefix) &&
          ENGINE_READ_TOOLS.includes(tool.slice(this.config.officeToolPrefix.length))
        if (!ok) decide({ outcome: 'failed', failure: `containment: ${safeName(tool)}` })
      } else if (name === 'approval.request') {
        state.denied += 1
        void hermes.deny(hermesRunId, typeof data.request_id === 'string' ? data.request_id : null)
        if (state.notes.length < LIMITS.notes) state.notes.push('a request for approval was denied')
      } else if (
        name === 'run.completed' ||
        name === 'run.failed' ||
        name === 'run.cancelled' ||
        name === 'run.interrupted'
      ) {
        state.terminal ??= { event: name, status: null, data }
      }
    }

    const readStream = async (): Promise<void> => {
      let reconnects = 0
      while (!ac.signal.aborted && state.terminal === null) {
        try {
          for await (const ev of hermes.events(hermesRunId, {
            ...(state.lastSeq >= 0 ? { lastEventId: state.lastSeq } : {}),
            signal: ac.signal,
          })) {
            handle(ev)
            if (state.terminal !== null) return
          }
        } catch {
          if (ac.signal.aborted) return
        }
        if (ac.signal.aborted || state.terminal !== null) return
        if (reconnects < t.reconnects) {
          reconnects += 1
          await this.sleep(t.reconnectDelayMs, ac.signal)
          continue
        }
        // The stream cannot be kept: read the run's own status until it is over (the watchdog still bounds the wait).
        const s = await hermes.run(hermesRunId).catch(() => null)
        if (s !== null && ['completed', 'failed', 'cancelled', 'interrupted'].includes(s.status)) {
          state.terminal = { event: `run.${s.status}`, status: s, data: {} }
          return
        }
        await this.sleep(1_000, ac.signal)
      }
    }

    const beat = async (): Promise<void> => {
      for (;;) {
        const body = {
          run_id: run.run_id,
          claim_gen: run.claim_gen,
          hermes_run_id: hermesRunId,
          progress: { events: state.events, tools: state.tools, last_event: state.lastEvent },
        }
        const r = await this.gateway.heartbeat(body)
        if (r.ok) {
          state.lastBeatOkAt = this.now()
          if (r.value.stop && !state.officeStopped) {
            state.officeStopped = true
            decide({ outcome: 'cancelled' })
          }
        } else if (
          r.error.kind === 'not_yours' ||
          r.error.kind === 'unauthorized' ||
          r.error.kind === 'not_running'
        ) {
          state.abandoned = true
          void stopHermes()
          return
        }
        if (ac.signal.aborted) return
        await this.sleep(t.heartbeatMs, ac.signal)
        if (ac.signal.aborted) return
      }
    }

    const deadline = new Date(run.deadline_at).getTime() + t.deadlineGraceMs
    const watch = async (): Promise<void> => {
      while (!ac.signal.aborted) {
        const now = this.now()
        if (state.abandoned) return
        if (state.terminal !== null) return
        if (state.verdict === null) {
          if (now - state.lastBeatOkAt > t.leaseGiveUpMs) {
            state.abandoned = true
            void stopHermes()
            return
          }
          if (now > deadline) decide({ outcome: 'failed', failure: 'deadline' })
          else if (now - state.lastEventAt > t.noProgressMs)
            decide({ outcome: 'failed', failure: 'no_progress' })
        } else if (now - state.verdictAt > t.stopWaitMs) {
          return
        }
        await this.sleep(t.tickMs, ac.signal)
      }
    }

    // The first heartbeat goes out at once, so a Stop pressed right now can reach this run.
    const reader = readStream()
    const beater = beat()
    await watch()
    ac.abort()
    await Promise.allSettled([reader, beater])
    if (stopping !== null) await Promise.allSettled([stopping])

    if (state.abandoned) {
      this.log(`run ${run.run_id}: the claim was lost; the run is not reported`)
      return { outcome: 'abandoned', sent: false, reason: 'claim_lost' }
    }

    const base = (): EngineRunResult => ({
      hermes_run_id: hermesRunId,
      tools_started: Math.min(state.tools, 999_999),
      approvals_denied: Math.min(state.denied, 999_999),
      ...(state.notes.length > 0 ? { notes: state.notes.slice(0, LIMITS.notes) } : {}),
    })
    // A decision of the bridge's own (containment, no progress, the deadline, the office's Stop) wins over whatever Hermes then reports.
    if (state.verdict !== null) {
      if (state.verdict.outcome === 'cancelled')
        return this.finish(run, 'cancelled', base(), 'stopped_by_office')
      return this.finish(
        run,
        'failed',
        { ...base(), failure: state.verdict.failure },
        state.verdict.failure,
      )
    }
    const term = state.terminal as Terminal | null
    if (term === null)
      return this.finish(run, 'failed', { ...base(), failure: 'no_result' }, 'no_result')
    return this.finish(run, ...(await this.fromTerminal(hermes, term, hermesRunId, base())))
  }

  /** Map Hermes's own end of a run onto the office's outcomes. */
  private async fromTerminal(
    hermes: HermesClient,
    term: Terminal,
    hermesRunId: string,
    base: EngineRunResult,
  ): Promise<[EngineOutcome, EngineRunResult, string]> {
    const d = term.data
    // The event normally carries everything; the run's own status is read only when it does not.
    const needsStatus =
      (term.event === 'run.completed' && typeof d.output !== 'string') ||
      (term.event === 'run.failed' && typeof d.error !== 'string')
    const s = term.status ?? (needsStatus ? await hermes.run(hermesRunId).catch(() => null) : null)
    if (term.event === 'run.completed') {
      const output = (typeof d.output === 'string' ? d.output : (s?.output ?? '')).trim()
      if (output === '') return ['failed', { ...base, failure: 'empty answer' }, 'empty_answer']
      const usageRaw =
        (typeof d.usage === 'object' && d.usage !== null
          ? (d.usage as Record<string, unknown>)
          : null) ??
        s?.usage ??
        null
      const whole = (v: unknown): number =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0
      const runtime =
        typeof d.runtime === 'object' && d.runtime !== null
          ? (d.runtime as Record<string, unknown>)
          : {}
      const model = (typeof runtime.model === 'string' ? runtime.model : (s?.model ?? '')).slice(
        0,
        160,
      )
      const notes = [...(base.notes ?? [])]
      let answer = output
      if (answer.length > LIMITS.answer) {
        answer = answer.slice(0, LIMITS.answer - 1)
        if (notes.length < LIMITS.notes) notes.push('the answer was cut to fit')
      }
      return [
        'completed',
        {
          ...base,
          answer,
          ...(model === '' ? {} : { model }),
          ...(usageRaw === null
            ? {}
            : {
                usage: {
                  input_tokens: whole(usageRaw.input_tokens),
                  output_tokens: whole(usageRaw.output_tokens),
                },
              }),
          ...(notes.length > 0 ? { notes } : {}),
        },
        'completed',
      ]
    }
    if (term.event === 'run.failed') {
      const error = (typeof d.error === 'string' ? d.error : (s?.error ?? 'the run failed'))
        .replace(/\s+/g, ' ')
        .trim()
      return [
        'failed',
        { ...base, failure: (error === '' ? 'the run failed' : error).slice(0, LIMITS.failure) },
        'hermes_failed',
      ]
    }
    // Cancelled or interrupted with no ask from the office: somebody else stopped it (a restart, an operator).
    return ['failed', { ...base, failure: 'interrupted' }, 'interrupted']
  }

  /** Report the end, retrying a gateway that is down for a while: the lease outlives a short outage and a lost report loses the answer. */
  private async finish(
    run: ClaimedRun,
    outcome: EngineOutcome,
    result: EngineRunResult,
    reason: string,
  ): Promise<Ended> {
    let r = result
    let o = outcome
    const problem = resultProblem(o, r)
    if (problem !== null) {
      this.log(
        `run ${run.run_id}: the result was not acceptable (${safeName(problem)}); reporting a failure instead`,
      )
      o = 'failed'
      r = {
        tools_started: Math.min(r.tools_started, 999_999),
        approvals_denied: Math.min(r.approvals_denied, 999_999),
        failure: 'bridge_result_invalid',
      }
    }
    const until = this.now() + this.timing.finishGiveUpMs
    for (;;) {
      const sent = await this.gateway.finish({
        run_id: run.run_id,
        claim_gen: run.claim_gen,
        outcome: o,
        result: r,
      })
      if (sent.ok) {
        this.log(
          `run ${run.run_id}: finished ${o}${sent.value.resumed ? ' (the job was woken)' : ''}`,
        )
        return { outcome: o, sent: true, reason }
      }
      const kind = sent.error.kind
      if (kind === 'not_yours' || kind === 'not_running' || kind === 'unauthorized') {
        this.log(`run ${run.run_id}: the gateway refused the report (${kind})`)
        return { outcome: o, sent: false, reason: `${reason}; report refused: ${kind}` }
      }
      if (kind === 'bad_request' && r.failure !== 'bridge_result_invalid') {
        o = 'failed'
        r = { tools_started: 0, approvals_denied: 0, failure: 'bridge_result_invalid' }
        continue
      }
      if (this.now() >= until) {
        this.log(
          `run ${run.run_id}: the report could not be delivered (${kind}); the lease will lapse`,
        )
        return { outcome: o, sent: false, reason: `${reason}; report not delivered` }
      }
      await this.sleep(this.timing.finishRetryMs)
    }
  }
}
