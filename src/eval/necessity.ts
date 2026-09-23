/**
 * Was a specialist NEEDED, or merely available? (#318)
 *
 * ## Opportunity is not necessity
 *
 * Almost any request could be handed to somebody with a title. That is not
 * the question, and a measurement that treats it as the question will always
 * conclude the office under-delegates — it is the "judge that marks
 * everything poor" shape CLAUDE.md records, pointed at routing.
 *
 * So this asks for a three-way verdict on concrete dimensions rather than
 * "would delegation be better":
 *
 *   unnecessary  the Chief could do it, or it needed no expertise at all
 *   beneficial   a specialist would MATERIALLY improve it, not merely touch it
 *   warranted    it could not be done properly without one
 *
 * ## Blind to what the office did
 *
 * The judge is never told who answered or whether anybody was convened, so
 * it cannot rationalise the routing it is being used to measure. It sees the
 * request and the answer, and nothing else.
 */

import type { ProviderRouter } from '../providers/router.ts'
import { redactSecrets } from '../text/secrets.ts'
import { JUDGE_MODEL } from './judge.ts'

export type Necessity = 'unnecessary' | 'beneficial' | 'warranted'

export interface Verdict {
  readonly necessity: Necessity
  /** Who would have helped, in the office's own vocabulary, or null. */
  readonly who: string | null
  readonly reason: string
  readonly model: string
}

const ROSTER =
  'chief-of-staff (coordination), strategy-director, research-director, ' +
  'finance-director, operations-director, growth-director, ' +
  'communications-director, quality-director'

export const NECESSITY = (ask: string, answer: string): string =>
  'You are auditing an AI office. It has a Chief of Staff who answers most ' +
  'things, and specialists who can be brought in.\n\n' +
  `The specialists: ${ROSTER}\n\n` +
  'Decide whether bringing a specialist in was NEEDED for this request. ' +
  'Judge on: factual and research quality, domain expertise, completeness, ' +
  'keeping to the constraints asked for, doing the right action, and ' +
  'usefulness to the person who asked. Weigh against the cost: extra ' +
  'latency, extra model calls, duplicated work and noise.\n\n' +
  'Answer with exactly one of:\n' +
  '  "unnecessary" — a generalist coordinator could do this as well, or it ' +
  'needs no expertise at all (a greeting, a status question, a correction, ' +
  'a reference to a document, a request the office simply lacks data for).\n' +
  '  "beneficial" — a specialist would MATERIALLY improve the result. Not ' +
  'merely that one could be involved: that the answer would be better in a ' +
  'way the person would notice.\n' +
  '  "warranted" — it could not be done properly without one.\n\n' +
  'Rules, all absolute:\n' +
  '- Almost anything COULD be given to a specialist. That is not the ' +
  'question. Only say beneficial or warranted when the OUTCOME changes.\n' +
  '- If the office plainly had no data to answer with, a specialist could ' +
  'not have helped either: that is "unnecessary".\n' +
  '- A request that is chat, a correction, or a question about the office ' +
  'itself is "unnecessary".\n' +
  '- Output only JSON: {"necessity": "...", "who": "<slug or null>", ' +
  '"reason": "<one sentence>"}\n\n' +
  `REQUEST:\n${ask.slice(0, 1_200)}\n\nWHAT THE OFFICE ANSWERED:\n${answer.slice(0, 2_000)}`

export const makeNecessityJudge =
  (router: ProviderRouter) =>
  async (ask: string, answer: string): Promise<Verdict | null> => {
    try {
      const result = await router.complete({
        messages: [{ role: 'user', content: NECESSITY(ask, answer) }],
        /*
          #116's lesson: a judge given too small a budget spends it thinking
          and returns nothing, which lands as "unreadable" and quietly moves
          the denominator.
        */
        maxTokens: 16_000,
        temperature: 0,
        model: JUDGE_MODEL,
        /*
          No `jobId`, deliberately (#268). This grades HISTORICAL rows in a
          measurement run: there is no job it belongs to, and attaching it to
          one of Grant's would put the measurement's own spending under his
          work. It lands `unattributed`, which is correct here and is the
          reason #268 asks for the reason to be written down rather than for
          the call to be silently exempt.
        */
      })
      const found = /\{[\s\S]*\}/.exec(result.content)
      if (found === null) return null
      const parsed = JSON.parse(found[0]) as {
        necessity?: string
        who?: string | null
        reason?: string
      }
      const n = String(parsed.necessity ?? '')
        .trim()
        .toLowerCase()
      if (n !== 'unnecessary' && n !== 'beneficial' && n !== 'warranted') return null
      const who = String(parsed.who ?? '').trim()
      return {
        necessity: n,
        who: who === '' || who.toLowerCase() === 'null' ? null : who,
        reason: redactSecrets(String(parsed.reason ?? '').slice(0, 220)),
        model: result.model,
      }
    } catch {
      return null
    }
  }
