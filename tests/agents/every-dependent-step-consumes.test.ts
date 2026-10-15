/**
 * EVERY DEPENDENT STEP CONSUMES ITS UPSTREAM (#283).
 *
 * `verify:pursues` proves the invariant for the capabilities its plans happen
 * to use, and `verify:composes` for whatever the planner happens to choose on
 * the day. Neither is a statement about the SET of executors — which is how
 * `task.extract` shipped taking only `db` and `jobId`, declaring a dependency
 * it never read, until a deployed run happened to produce
 * `notebook.read → task.extract` and the chain check went red.
 *
 * This asks the question of every executor at once, so the next one added
 * cannot be the second. Two properties, both structural:
 *
 *   1. An executor that can be a dependent step must READ `from`. An executor
 *      that ignores it can still be given `needs` by the planner, and then the
 *      plan says one thing and the office does another.
 *   2. Given an upstream that found nothing, it must not claim success.
 *
 * Read off `EXECUTORS` rather than a list somebody maintains, because a list
 * is the thing that goes stale.
 */
import { describe, expect, it } from 'vitest'
import { EXECUTORS, type Observation } from '../../src/agents/perform.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

/** A word no executor could produce by any route except reading the upstream. */
const DISTINCTIVE = 'glimberwock'

/**
 * A database that answers every write plausibly.
 *
 * Deliberately generous: an executor that failed on the DATABASE would decline
 * for a reason that has nothing to do with its upstream, and the check would
 * pass for the wrong reason — which is the failure this whole file is about.
 */
const seen: string[] = []
const silentDb = {
  execute: async (sql: string) => {
    seen.push(sql)
    if (sql.includes('tool_permissions')) return { rows: [{ enabled: true, level: 1 }] }
    if (sql.includes('from public.documents')) {
      return { rows: [{ t: `The ${DISTINCTIVE} handbook` }] }
    }
    // The job's project (or the catch-all project) that a task is filed under.
    if (sql.includes('from public.jobs') && sql.includes('as project')) {
      return { rows: [{ project: '22222222-2222-2222-2222-222222222222' }] }
    }
    return {
      rows: [
        {
          id: '44444444-4444-4444-4444-444444444444',
          t: JSON.stringify({ ok: true, id: '44444444-4444-4444-4444-444444444444' }),
        },
      ],
    }
  },
} as unknown as SqlExecutor

const upstreamFound: Observation = {
  capability: 'notebook.read',
  found: true,
  ids: ['33333333-3333-3333-3333-333333333333'],
  saw: `"The ${DISTINCTIVE} handbook": it has not been reviewed since it was written.`,
}

const upstreamFoundNothing: Observation = {
  capability: 'notebook.read',
  found: false,
  ids: [],
  saw: '',
  impediment: 'nothing matched',
}

/**
 * A provider that hands back whatever it was given.
 *
 * `draft.create` is the one executor that spends a model, and without one it
 * declines for a reason that has nothing to do with its upstream — so the
 * check would pass for the wrong reason, which is the failure this file is
 * about. Echoing the prompt is also exactly the right probe: if the material
 * reached the model, the token is in what comes back.
 */
const echoRouter = {
  complete: async (req: { messages: readonly { content: string }[] }) => ({
    content: req.messages.map((m) => m.content).join(' '),
    model: 'test/echo',
  }),
} as never

const doing = (capability: string) => ({
  db: silentDb,
  router: echoRouter,
  jobId: '11111111-1111-1111-1111-111111111111',
  projectId: '22222222-2222-2222-2222-222222222222',
  request: 'go through the material and work out what is out of date',
  step: {
    id: 's2',
    capability,
    why: 'act on what was found',
    needs: ['s1'] as readonly string[],
    specialist: null,
    audience: 'grant' as const,
  },
  from: { s1: upstreamFoundNothing },
})

describe('no executor may ignore the dependency the plan declared', () => {
  /*
    The planner may put `needs` on any step, so every executor is a candidate
    dependent step. The ones that genuinely cannot consume anything are the
    READS — they gather rather than act on what was gathered — and they are
    named here so that adding one is a deliberate act.
  */
  const gatherers = new Set(['db.read', 'notebook.read'])
  const actors = Object.keys(EXECUTORS).filter((k) => !gatherers.has(k))

  it('there are actors to check, so this file is not vacuous', () => {
    expect(actors.length).toBeGreaterThan(0)
  })

  for (const capability of actors) {
    it(`${capability} declines when the step it depends on found nothing`, async () => {
      const answered = await EXECUTORS[capability]?.run(doing(capability))
      // A pause is a legitimate answer (an outage), but not for this input —
      // there is nothing to be early about when the upstream came back empty.
      expect(answered, `${capability} answered with nothing at all`).toBeDefined()
      const observation = answered as Observation
      expect(observation.found, `${capability} claimed success on an empty upstream`).toBe(false)
      expect(
        String(observation.impediment ?? ''),
        `${capability} declined without saying why`,
      ).not.toBe('')
    })

    it(`${capability} carries what the upstream found into what it records`, async () => {
      /*
        THE FIRST VERSION OF THIS CHECK WAS SATISFIED BY A SUPERSTRING.

        It scanned the executor's source for the word `from`. Putting the
        defect back — `task.extract` ignoring its dependency — left it GREEN,
        because the sabotage happened to declare a LOCAL called `from`. #268,
        in a check written an hour after reading #268.

        Behavioural instead: given an upstream that found something
        distinctive, whatever the step records must carry evidence of it. An
        executor that ignores `from` cannot produce that token by any route.
      */
      seen.length = 0
      const answered = await EXECUTORS[capability]?.run({
        ...doing(capability),
        from: { s1: upstreamFound },
      })
      const observation = answered as Observation
      expect(observation, `${capability} answered with nothing at all`).toBeDefined()
      /*
        What it RECORDED or what it WROTE — both count, and the difference is
        real rather than a convenience. `task.create` consumes the upstream
        into the task's detail, which is a row in the database and not part of
        its observation; `notebook.read` and `draft.create` consume into what
        they record. An executor that ignores `from` produces neither.
      */
      const emitted = `${JSON.stringify(observation)} ${seen.join(' ')}`
      expect(
        emitted,
        `${capability} neither recorded nor wrote anything traceable to the earlier step`,
      ).toContain(DISTINCTIVE)
    })
  }
})
