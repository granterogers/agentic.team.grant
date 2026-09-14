import { describe, expect, it } from 'vitest'
import type { JobState } from '../../src/jobs/states.ts'
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  DORMANT_STATES,
  IllegalTransitionError,
  IN_FLIGHT_STATES,
  isTerminal,
  JOB_STATES,
  needsRecovery,
  TERMINAL_STATES,
} from '../../src/jobs/states.ts'

/**
 * The exact list from master spec §6, transcribed independently of the
 * implementation. If someone edits JOB_STATES, this fails — which is the point:
 * the state set is a specification claim, not an implementation detail.
 */
const SPEC_STATES = [
  'queued',
  'running',
  'waiting_external',
  'waiting_user',
  'output_created',
  'quality_review',
  'committing',
  'committed',
  'notifying',
  'complete',
  'retrying',
  'paused',
  'cancelled',
  'failed',
]

describe('the state set matches the specification', () => {
  it('has exactly the fourteen states §6 lists, in order', () => {
    expect([...JOB_STATES]).toEqual(SPEC_STATES)
  })

  it('is not the nine-state version the subordinate docs described', () => {
    // core-invariants.md §4 and implementation-plan.md both said nine. The spec
    // wins (ADR-0008). Asserting the count stops a well-meaning simplification.
    expect(JOB_STATES.length).toBe(14)
  })
})

describe('the three state groups partition every state', () => {
  it('covers all fourteen with no overlap', () => {
    const groups = [...TERMINAL_STATES, ...IN_FLIGHT_STATES, ...DORMANT_STATES]
    expect(groups.length).toBe(JOB_STATES.length)
    expect(new Set(groups).size).toBe(JOB_STATES.length)
    expect([...groups].sort()).toEqual([...JOB_STATES].sort())
  })

  it('classifies every state as exactly one of the three', () => {
    // A state falling through every group is how a job becomes invisible to
    // both the recovery sweep and the dequeue — stuck forever with nothing
    // looking for it.
    for (const state of JOB_STATES) {
      const memberships = [
        (TERMINAL_STATES as readonly JobState[]).includes(state),
        (IN_FLIGHT_STATES as readonly JobState[]).includes(state),
        (DORMANT_STATES as readonly JobState[]).includes(state),
      ].filter(Boolean)
      expect(memberships, `${state} belongs to ${memberships.length} groups`).toHaveLength(1)
    }
  })
})

describe('terminal states', () => {
  it('are complete, cancelled and failed', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(['cancelled', 'complete', 'failed'])
  })

  it('have no outgoing transitions', () => {
    for (const state of TERMINAL_STATES) {
      expect(ALLOWED_TRANSITIONS[state], state).toEqual([])
    }
  })

  it('are reported terminal', () => {
    for (const state of JOB_STATES) {
      expect(isTerminal(state)).toBe((TERMINAL_STATES as readonly JobState[]).includes(state))
    }
  })
})

describe('graph integrity', () => {
  it('declares a transition list for every state', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...JOB_STATES].sort())
  })

  it('never targets an unknown state', () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of targets) {
        expect(JOB_STATES, `${from} -> ${to}`).toContain(to)
      }
    }
  })

  it('has no self-transitions', () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      expect(targets, from).not.toContain(from)
    }
  })

  it('lists no duplicate targets', () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      expect(new Set(targets).size, from).toBe(targets.length)
    }
  })

  it('reaches every state from queued', () => {
    // An unreachable state is dead code that will nonetheless be written into
    // the database by someone eventually.
    const seen = new Set<JobState>(['queued'])
    const queue: JobState[] = ['queued']
    while (queue.length > 0) {
      const current = queue.shift() as JobState
      for (const next of ALLOWED_TRANSITIONS[current]) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    expect([...seen].sort()).toEqual([...JOB_STATES].sort())
  })

  it('gives every state except queued at least one way in', () => {
    const withInbound = new Set<JobState>()
    for (const targets of Object.values(ALLOWED_TRANSITIONS)) {
      for (const to of targets) withInbound.add(to)
    }
    for (const state of JOB_STATES) {
      if (state === 'queued') continue
      expect(withInbound, `nothing transitions into ${state}`).toContain(state)
    }
  })

  it('lets every non-terminal state reach a terminal state', () => {
    // Otherwise a job can be alive with no legal way to ever finish.
    const canFinish = (start: JobState): boolean => {
      const seen = new Set<JobState>([start])
      const queue: JobState[] = [start]
      while (queue.length > 0) {
        const current = queue.shift() as JobState
        if (isTerminal(current)) return true
        for (const next of ALLOWED_TRANSITIONS[current]) {
          if (!seen.has(next)) {
            seen.add(next)
            queue.push(next)
          }
        }
      }
      return false
    }
    for (const state of JOB_STATES) {
      expect(canFinish(state), `${state} can never terminate`).toBe(true)
    }
  })
})

describe('the quality gate cannot be bypassed (§10)', () => {
  it('offers no direct edge from output_created to committing', () => {
    expect(canTransition('output_created', 'committing')).toBe(false)
  })

  it('routes output_created to committing only through quality_review', () => {
    // Enumerate every path and assert quality_review is on all of them, rather
    // than trusting that one missing edge is enough.
    const paths: JobState[][] = []
    const walk = (state: JobState, path: JobState[]): void => {
      if (path.length > JOB_STATES.length) return
      if (state === 'committing') {
        paths.push(path)
        return
      }
      for (const next of ALLOWED_TRANSITIONS[state]) {
        if (!path.includes(next)) walk(next, [...path, next])
      }
    }
    walk('output_created', ['output_created'])

    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(path, `path bypassing review: ${path.join(' -> ')}`).toContain('quality_review')
    }
  })

  it('lets review send work back rather than only forward', () => {
    expect(canTransition('quality_review', 'running')).toBe(true)
  })
})

describe('durability rules', () => {
  it('does not allow cancelling a commit in progress', () => {
    // A cancel racing the commit would make `committed` unreliable, and
    // `committed` is the one thing recovery reads.
    expect(canTransition('committing', 'cancelled')).toBe(false)
  })

  it('does not allow cancelling committed work', () => {
    // It happened. Undo is a compensating event, not a state change (§6).
    expect(canTransition('committed', 'cancelled')).toBe(false)
  })

  it('recovers a job that crashed after commit but before notification', () => {
    // §18's degradation test, expressible only because `committed` and
    // `notifying` are distinct states.
    expect(needsRecovery('committed')).toBe(true)
    expect(canTransition('committed', 'notifying')).toBe(true)
  })

  it('retries delivery without re-running committed work', () => {
    expect(canTransition('notifying', 'retrying')).toBe(true)
    expect(canTransition('notifying', 'running')).toBe(false)
  })

  it('sends a retry back through the queue, not straight to running', () => {
    // Capacity limits are enforced at dequeue (§6). Jumping to `running` would
    // let a retry storm walk straight past them.
    expect(canTransition('retrying', 'queued')).toBe(true)
    expect(canTransition('retrying', 'running')).toBe(false)
  })

  it('resumes a paused job through the queue for the same reason', () => {
    expect(canTransition('paused', 'queued')).toBe(true)
    expect(canTransition('paused', 'running')).toBe(false)
  })
})

describe('cancellation and pause are first-class (§6)', () => {
  it('can cancel from every state where work has not yet committed', () => {
    const preCommit: JobState[] = [
      'queued',
      'running',
      'waiting_external',
      'waiting_user',
      'output_created',
      'quality_review',
      'retrying',
      'paused',
    ]
    for (const state of preCommit) {
      expect(canTransition(state, 'cancelled'), `cannot cancel from ${state}`).toBe(true)
    }
  })

  it('can pause active work', () => {
    for (const state of ['queued', 'running', 'output_created', 'quality_review'] as JobState[]) {
      expect(canTransition(state, 'paused'), `cannot pause from ${state}`).toBe(true)
    }
  })
})

describe('recovery classification', () => {
  it('marks in-flight states as needing recovery and dormant ones as not', () => {
    for (const state of IN_FLIGHT_STATES) expect(needsRecovery(state), state).toBe(true)
    for (const state of DORMANT_STATES) expect(needsRecovery(state), state).toBe(false)
    for (const state of TERMINAL_STATES) expect(needsRecovery(state), state).toBe(false)
  })

  it('leaves a paused job alone', () => {
    expect(needsRecovery('paused')).toBe(false)
  })
})

describe('assertTransition', () => {
  it('permits a legal transition', () => {
    expect(() => assertTransition('queued', 'running')).not.toThrow()
  })

  it('throws IllegalTransitionError on an illegal one', () => {
    expect(() => assertTransition('complete', 'running')).toThrow(IllegalTransitionError)
  })

  it('names the offending transition and the legal alternatives', () => {
    // The error has to be actionable at 3am from a log line alone.
    expect(() => assertTransition('output_created', 'committing')).toThrow(
      /output_created -> committing[\s\S]*quality_review/,
    )
  })

  it('says "terminal" rather than listing nothing', () => {
    expect(() => assertTransition('failed', 'queued')).toThrow(/terminal/)
  })
})

describe('#237: a coherence refusal retries before it fails', () => {
  /*
    The gate that catches a fabricated read used to move the job straight to
    `failed`, and Grant received nothing at all — no answer, no explanation.
    Two of four turns in an ordinary correction conversation went that way,
    and 6% of the night's session traffic.

    The worker now moves it to `retrying` while attempts remain. That is only
    coherent if the state machine permits it, and asserting the permission here
    rather than in the worker is deliberate: the transition table is the
    specification, and a worker written against a move the table forbids fails
    four steps from the line that caused it — which CLAUDE.md records costing
    a day when two jobs stranded in `committing`.
  */
  it('allows running -> retrying, which is the move the gate now makes', () => {
    expect(canTransition('running', 'retrying')).toBe(true)
  })

  it('still allows running -> failed, for the attempt that runs out', () => {
    expect(canTransition('running', 'failed')).toBe(true)
  })

  it('lets a retrying job be picked up again', () => {
    // Otherwise the retry is a slower way of losing the answer.
    expect(ALLOWED_TRANSITIONS.retrying.length).toBeGreaterThan(0)
    expect(isTerminal('retrying')).toBe(false)
  })
})
