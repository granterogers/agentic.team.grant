/**
 * What a person is told when a plan stops at a step: in plain words, never in the plan's own codes.
 *
 * Version 1 acceptance (journey G) found the approval message reading
 * `I have stopped before "s4:draft.create" because I need you to say. draft.create: ...`. A step id and a tool code
 * are the plan's bookkeeping. CLAUDE.md records what such a reference becomes in text a person or a model reads:
 * part of the answer (#242). The id stays where it is wanted -- the step name in `job_steps`, the `binds` the
 * approval's fingerprint is made from, the job's pause detail -- and never in the sentence.
 *
 * One composer, so a handler cannot print `run.at` or the pause's tool-prefixed detail by hand again.
 */
import type { Paused } from '../jobs/checkpoint.ts'

/**
 * The shape of a compiled step name or a tool code: `s4:draft.create`, `r2:s1:task.create`, `2:create_project`.
 * Requires a dotted or underscored tool code after the colon, so a clock time ("9:30", "5:pm") is not one.
 */
export const STEP_ID_SHAPE = /\b(?:r\d+:)?(?:s?\d+):[a-z][a-z0-9]*(?:[._][a-z0-9]+)+/i

/** A tool code on its own, as a registry names it: `draft.create`, `web.search`. */
const TOOL_PREFIX = /^\s*[a-z][a-z0-9]*(?:[._][a-z0-9]+)+:\s+/i

/**
 * What the step is FOR, in the step's own words, or a plain stand-in.
 *
 * The description is whatever the plan said the step does (`binds.why`); an approval is consent to that action, so it
 * is what the person should read. Nothing is invented: with no description the stand-in is "the next step".
 */
export function stepInWords(pause: Pick<Paused, 'binds'> | undefined): string {
  const why = (pause?.binds as { why?: unknown } | undefined)?.why
  if (typeof why === 'string') {
    const clean = why.trim().replace(/\s+/g, ' ').slice(0, 160)
    if (clean !== '' && !STEP_ID_SHAPE.test(clean)) return clean
  }
  return 'the next step'
}

/**
 * The pause's reason as a sentence a person reads: the stored detail is `<tool code>: <reason>` (kept that way for the
 * job's own state and for the policy's record), so the prefix is taken off here, not at the writer.
 */
export function reasonInWords(pause: Pick<Paused, 'detail'>): string {
  return pause.detail.replace(TOOL_PREFIX, '').trim()
}

/** The whole sentence for a plan that stopped to ask. */
export function stoppedToAsk(pause: Paused): string {
  return `I have stopped before "${stepInWords(pause)}" because I need you to say. ${reasonInWords(pause)} ${pause.resumeWhen}`
}

/** The whole sentence for a plan that stopped for another reason (not a question). */
export function stoppedPartWay(pause: Paused): string {
  return `I stopped part way through, at "${stepInWords(pause)}": ${reasonInWords(pause)} ${pause.resumeWhen}`
}
