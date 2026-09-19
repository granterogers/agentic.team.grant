/**
 * A capability the office has on a schedule is not one the agent has now.
 *
 * ## The answer that caused this
 *
 * A conversation asked the office to put something in the diary, and it said:
 *
 *     I've added a calendar event on Tuesday 20 Sept, 8 am-12 pm titled "Hando"
 *
 * Nothing was added, and nothing could have been. #185's coherence gate
 * refused the output — correctly — and the office retried, and it said the
 * same thing again, four times, until the job ran out of attempts. Grant asked
 * for something and received nothing at all.
 *
 * ## Why it believed itself
 *
 * `capabilityBrief` puts `tool_permissions.verbs` in front of every agent on
 * every turn, and `calendar.write`'s read:
 *
 *     calendar.write — you can create an all-day event for a dated task, move
 *     one when the task's date changes, remove one when the task is done …
 *
 * Every clause true of the OFFICE; not one true of the colleague writing the
 * reply. The only thing that writes the diary is the job kind
 * `google.write_calendar_tasks`, started by an hourly duty and by nothing
 * else: `src/handlers/instruction.ts` enqueues nine kinds and that is not one
 * of them. And the brief's closing instruction — *"do not offer to produce
 * something ready for you to add when you can add it yourself; if a verb above
 * covers it, use it"* — is right, and is what turned an unqualified verb list
 * from a description into a push.
 *
 * This is 0298's `web.search` defect with the mechanism moved one column
 * along. That one was a tool claimed with nothing behind it; here the
 * performer exists, works, and runs on a clock the conversation cannot reach.
 * CLAUDE.md on the direction that costs: *"being told YES about something
 * impossible costs the work, silently, and Grant finds out when nothing
 * arrives."*
 *
 * ## What is asserted, and what deliberately is not
 *
 * Not the wording — this file has been paid for six times over by literal
 * string assertions, and rewording the brief is a legitimate change. What is
 * asserted is the PROPERTY: a scheduled-only tool never appears in the "you
 * can" list, an in-reply tool always does, and the two are never conflated.
 *
 * The negative controls matter more than the positives here. Dropping a real
 * tool out of the brief would make an agent say it cannot do something it can,
 * which is #64 — the defect `capability.ts` exists to fix — so every assertion
 * that something is withheld is paired with one that something is offered.
 */
import { describe, expect, it } from 'vitest'
import {
  type Able,
  type Capability,
  capabilityBrief,
  EMPTY_CAPABILITY,
  type Reach,
} from '../../src/agents/capability.ts'

const REACH: Reach[] = [{ service: 'Slack', reachable: true, detail: null }]

const able = (over: Partial<Capability> = {}): Capability => ({
  ...EMPTY_CAPABILITY,
  reach: REACH,
  ...over,
})

/** Verbatim from `public.tool_permissions` after 0508. */
const CALENDAR_WRITE: Able = {
  tool: 'calendar.write',
  what: 'Mirror dated tasks into the diary as all-day events, on the hourly sync',
  verbs: [
    'on the hourly sync, put a task that has a DATE into the diary as an all-day event',
    'move that event when the date changes, and remove it when the task is done',
    'only ever touch events the office created, matched on a stored tag',
    'never in a reply, and never a timed event: the way into the diary is to give a task a date',
  ],
  inReply: false,
}

/** Verbatim, and the control: this one really is available in the turn. */
const TASK_CREATE: Able = {
  tool: 'task.create',
  what: 'Create a task',
  verbs: ['create a task with a title, and optionally a date, an owner and a project'],
  inReply: true,
}

describe('a tool the clock performs is not one you can perform', () => {
  it('never says "you can" about a scheduled-only tool', () => {
    /*
      The load-bearing assertion. `you can <verb>` is the phrasing the brief
      uses for something the agent may do in this turn, and the closing
      instruction tells it to use one rather than offer to prepare something.
    */
    const brief = capabilityBrief(able({ can: [CALENDAR_WRITE] }))
    expect(brief).not.toContain('calendar.write — you can')
  })

  it('does not put its verbs in front of the model either', () => {
    // Naming the tool is fine and wanted. Reciting what it can be made to do,
    // in a list the next sentence says to act on, is the defect.
    const brief = capabilityBrief(able({ can: [CALENDAR_WRITE] }))
    for (const verb of CALENDAR_WRITE.verbs) expect(brief).not.toContain(verb)
  })

  it('still NAMES it, so an agent can tell Grant how to reach it', () => {
    /*
      ADR-0018's reason, and the whole difference between this and switching
      the tool off: an agent that does not know a capability exists cannot say
      what would make it happen. Withholding the verbs must not withhold the
      fact.
    */
    const brief = capabilityBrief(able({ can: [CALENDAR_WRITE] }))
    expect(brief).toContain('calendar.write')
    expect(brief.toLowerCase()).toContain('schedule')
  })

  it('tells it not to claim one as done', () => {
    const brief = capabilityBrief(able({ can: [CALENDAR_WRITE] }))
    expect(brief.toLowerCase()).toContain('do not say you have')
  })

  it('CONTROL: an in-reply tool keeps its verbs and its "you can"', () => {
    /*
      The expensive direction, and the reason for every pairing in this file.
      A fix that quietened the brief would reintroduce #64 — the office saying
      it lacks access to things it has — which is worse than the fabrication,
      because the fabrication at least fails loudly at the gate.
    */
    const brief = capabilityBrief(able({ can: [TASK_CREATE] }))
    expect(brief).toContain('task.create — you can')
    expect(brief).toContain(TASK_CREATE.verbs[0] as string)
  })

  it('CONTROL: holding both keeps them apart', () => {
    const brief = capabilityBrief(able({ can: [CALENDAR_WRITE, TASK_CREATE] }))
    expect(brief).toContain('task.create — you can')
    expect(brief).not.toContain('calendar.write — you can')
    // And the scheduled one is not simply dropped on the floor.
    expect(brief).toContain('calendar.write')
  })

  it('CONTROL: a scheduled tool with no verbs is not announced as held', () => {
    /*
      `You also hold: …` is the no-verbs branch of the same list, and it makes
      the same promise in fewer words. Splitting only the verbs branch would
      have left this one saying it.
    */
    const brief = capabilityBrief(
      able({
        can: [{ tool: 'drive.ingest', what: 'Ingest Drive files', verbs: [], inReply: false }],
      }),
    )
    expect(brief).not.toContain('You also hold: drive.ingest')
    expect(brief).toContain('drive.ingest')
  })

  it('CONTROL: says nothing about a schedule when nothing is on one', () => {
    // A caveat printed on every turn is one nobody reads — the same reason
    // `project_knowledge` leaves its note empty when coverage is complete.
    const brief = capabilityBrief(able({ can: [TASK_CREATE] }))
    expect(brief.toLowerCase()).not.toContain('on its own schedule')
  })
})
