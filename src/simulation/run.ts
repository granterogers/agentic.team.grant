/**
 * Driving a generated corpus through a door and scoring what comes back.
 *
 * The firewall sits IN the path, not beside it: every message goes through
 * `sealed` on its way to the office, and a leak throws rather than being
 * recorded as a low score. §10 puts a leaked intent among the hard failures
 * because a run in which one happened is not a run whose other numbers mean
 * anything.
 */

import type { GeneratedScenario } from './compose.ts'
import type { Verdicts } from './dimensions.ts'
import { evaluate } from './evaluate.ts'
import { HiddenIntentLeak, sealed } from './isolation.ts'
import { utteranceOf } from './scenario.ts'
import type { Observation, Transport, TurnContext } from './transport.ts'

export interface RunSummary {
  readonly door: string
  readonly scenarios: number
  readonly verdicts: readonly Verdicts[]
  /** Scenarios that could not be run at all, and why. */
  readonly unrun: readonly { readonly scenario: string; readonly because: string }[]
  readonly ms: number
  readonly modelCalls: number
  /**
   * Leaks, which invalidate the run rather than scoring in it.
   *
   * Non-empty here means the numbers above must not be reported. A summary
   * that carried a leak in a footnote would be one somebody quotes the
   * headline from.
   */
  readonly leaks: readonly string[]
}

export const runCorpus = async (
  corpus: readonly GeneratedScenario[],
  transport: Transport,
): Promise<RunSummary> => {
  const started = Date.now()
  const verdicts: Verdicts[] = []
  const unrun: { scenario: string; because: string }[] = []
  const leaks: string[] = []

  if (!transport.reachable) {
    return {
      door: transport.door,
      scenarios: corpus.length,
      verdicts: [],
      unrun: corpus.map((s) => ({
        scenario: s.id,
        because: transport.blockedBecause ?? 'the door is not reachable in this environment',
      })),
      ms: Date.now() - started,
      modelCalls: 0,
      leaks: [],
    }
  }

  for (const scenario of corpus) {
    // History is per-scenario, and is the office's OWN words plus the
    // person's - never the scenario's notes about either. The firewall is
    // handed it explicitly for that reason: a leak through the history is
    // the one that would otherwise be invisible.
    const history: { who: 'person' | 'office'; text: string }[] = []
    let hadAnswer = false

    for (const turn of scenario.turns) {
      const context: TurnContext = {
        // One conversation per SCENARIO. Two scenarios in one run are two
        // different people talking, as far as the office is concerned.
        conversation: scenario.id,
        history,
        standing: scenario.standing ?? [],
        hadAnswer,
      }
      let sent: string
      try {
        sent = sealed(scenario, turn, utteranceOf(scenario.channel, turn.say), [
          ...history.map((h) => h.text),
          ...(scenario.standing ?? []),
        ]).text
      } catch (e) {
        if (e instanceof HiddenIntentLeak) {
          leaks.push(`${scenario.id}: ${e.message}`)
          break
        }
        throw e
      }

      let observation: Observation
      try {
        observation = await transport.ask({ text: sent, channel: scenario.channel }, context)
      } catch (e) {
        // A door failing on one scenario must not end the run. §25: bounded
        // failure, classify, continue - and the scenario is reported unrun
        // rather than scored, because a crash is not a verdict about the
        // product.
        unrun.push({ scenario: scenario.id, because: (e as Error).message })
        break
      }

      verdicts.push(evaluate({ scenario, turn, sent, observation }))
      history.push({ who: 'person', text: sent })
      if (observation.reply !== '') {
        history.push({ who: 'office', text: observation.reply })
        hadAnswer = true
      }
    }
  }

  return {
    door: transport.door,
    scenarios: corpus.length,
    verdicts,
    unrun,
    ms: Date.now() - started,
    modelCalls: verdicts.reduce((n, v) => n + v.modelCalls, 0),
    leaks,
  }
}
