/**
 * The office's answer when Hermes has finished (INTERFACE-CONTRACTS section 8.5), and the sentences it owes when Hermes did not.
 *
 * Pure. Hermes's text is an UNTRUSTED model answer: it gets the same treatment as any answer the office's own model writes. It is
 * labelled `inferred` (never `verified`), its grounding is only what the office's tool gate actually served to it, and v1 can change
 * nothing, so `acted` and `tasksChanged` are zero and the consequence gate refuses any claim of having created or sent something.
 */
import { type Context, type Domain, established } from '../../agents/provenance.ts'
import type { HandlerOutput } from '../../jobs/worker.ts'
import { ENGINE_READ_TOOLS, OFFICE_TOOL_PREFIX } from './timing.ts'
import type { EngineRunRow } from './types.ts'

/** What the office read back about a run's served calls (`app.engine_run_grounding`). */
export interface RunGrounding {
  readonly excerpts: readonly string[]
  readonly domains: readonly string[]
  readonly complete_domains: readonly string[]
  readonly tools: readonly string[]
}

export interface OutputContext {
  readonly asked: string
  /** The person's own earlier words in this conversation. */
  readonly saidBefore: readonly string[]
  /** The office's own earlier answers: conversation, never evidence. */
  readonly answeredBefore: readonly string[]
  readonly grounding: RunGrounding
  /** How many open projects the office holds, for the gate that refuses a denial of a list it was handed. */
  readonly openProjects: number
  readonly standingRules: readonly string[]
}

const DOMAINS: readonly Domain[] = [
  'documents',
  'projects',
  'tasks',
  'mail',
  'calendar',
  'contacts',
]
const asDomains = (values: readonly string[]): Domain[] => DOMAINS.filter((d) => values.includes(d))

/** The same shape as every deterministic answer: composed in code, so `path` is decided by the caller after any model spend. */
type Said = Pick<
  HandlerOutput,
  'body' | 'confidence' | 'evidence' | 'sources' | 'contradictions' | 'model' | 'announce'
>

/**
 * A plain code-composed sentence about what the office itself did or did not do. `announce` is left to the job's own flag unless given.
 *
 * It cites the job (`job:<id>`), the way every other code-composed sentence in the handler does: "verified" means somebody can go and
 * check, and what they check is the job's own record. The output-metadata gate refuses `verified` with no source at all.
 */
export const saying = (body: string, jobId: string, announce?: boolean): Said => ({
  body,
  confidence: 'high',
  evidence: 'verified',
  sources: [`job:${jobId}`],
  contradictions: null,
  model: null,
  ...(announce === undefined ? {} : { announce }),
})

/** The answer, or null when Hermes's answer is empty (the caller then treats the run as failed). */
export function hermesOutput(
  run: EngineRunRow,
  ctx: OutputContext,
): Omit<HandlerOutput, 'path'> | null {
  const body = (run.result?.answer ?? '').trim()
  if (body === '') return null
  const consultedDomains = asDomains(ctx.grounding.domains)
  const completeDomains = asDomains(ctx.grounding.complete_domains)
  const shown: Context = {
    asked: ctx.asked,
    saidBefore: ctx.saidBefore,
    retrieved: ctx.grounding.excerpts,
    answeredBefore: ctx.answeredBefore,
    consultedDomains,
    completeDomains,
  }
  const model = run.result?.model?.trim()
  return {
    body,
    // The waiting pass wrote `announce = false` onto the job, so the answer has to say it is worth telling the person.
    announce: true,
    confidence: 'medium',
    evidence: 'inferred',
    // One source per distinct tool that actually served a read: the `<scheme>:<ref>` shape the citation check accepts.
    sources: [...new Set(ctx.grounding.tools)].sort().map((t) => `hermes:${t}`),
    contradictions: null,
    model: model === undefined || model === '' ? 'hermes-agent' : model,
    grounding: established(shown),
    consulted: { consulted: consultedDomains, complete: completeDomains },
    // The census is only declared when the run was actually shown the project list.
    holds: completeDomains.includes('projects') ? { projects: ctx.openProjects } : {},
    toolNames: [...ENGINE_READ_TOOLS, ...ENGINE_READ_TOOLS.map((t) => `${OFFICE_TOOL_PREFIX}${t}`)],
    standingRules: ctx.standingRules,
    acted: 0,
    tasksChanged: 0,
  }
}

/** A run's failure in words a person can read. The raw failure text is never shown: it came from outside the office. */
export const failureInWords = (failure: string | null): string => {
  // The bridge writes reasons as snake_case words (`bridge_lost`, `no_progress`, `containment: <tool>`).
  const f = (failure ?? '').toLowerCase().replace(/_/g, ' ')
  if (f.includes('bridge lost') || f.includes('retired'))
    return 'the computer running it stopped answering'
  if (f.includes('containment')) return 'it tried to use something the office does not allow'
  if (f.includes('deadline')) return 'it ran out of time'
  if (f.includes('429') || f.includes('rate')) return 'the free model it uses was busy'
  if (f.includes('no progress') || f.includes('stalled')) return 'it stopped making progress'
  if (f.includes('empty')) return 'it came back with no answer'
  return 'it ran into a problem'
}

export const unavailableSentence = (because: string): string =>
  `I haven't sent this to Hermes: ${because.replace(/[.\s]+$/, '')}. Nothing else was done with it. ` +
  "Send it again without Hermes selected if you'd like the team to take it."

export const failedSentence = (failure: string | null): string =>
  `Hermes couldn't finish this (${failureInWords(failure)}). Nothing was changed. Ask again, or send it to the team.`

export const cancelledSentence = (): string =>
  "Stopped. Hermes hadn't finished, so there's no answer to show."

export const expiredSentence = (minutes: number): string =>
  `Hermes took longer than ${String(minutes)} minutes, so I stopped waiting. Nothing was changed.`
