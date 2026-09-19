/**
 * The sentence that caused this file, and the ones that must still be allowed.
 */
import { describe, expect, it } from 'vitest'
import {
  type Capability,
  capabilityBrief,
  contradictsReality,
  EMPTY_CAPABILITY,
  type Reach,
} from '../../src/agents/capability.ts'

const REACH: Reach[] = [
  { service: 'Notion', reachable: true, detail: null },
  { service: 'Slack', reachable: true, detail: null },
  { service: 'Google NotebookLM', reachable: true, detail: null },
  { service: 'GitHub', reachable: false, detail: 'no read token for other repos' },
]

/*
  A capability is five lists now, not one (#148). `contradictsReality` still
  takes the reach on its own — it is a scan over service names and nothing else
  — so `REACH` stays exactly as it was, which is the point: the guard that
  caught #64's sentence is unchanged and still has to pass.
*/
const able = (over: Partial<Capability> = {}): Capability => ({
  ...EMPTY_CAPABILITY,
  reach: REACH,
  ...over,
})

describe('claiming it cannot reach something it can', () => {
  it('catches the reply that started this', () => {
    // Verbatim, from Slack, 2026-09-09. Every clause of it false.
    const said =
      "I can't post to Slack or pull data from your Notion teamspace. " +
      "I don't have integration access and I can't see the notebook you mention."
    expect(contradictsReality(said, REACH)).not.toBeNull()
  })

  it('catches the quieter phrasings too', () => {
    for (const said of [
      'I do not have access to Notion, so I cannot help with that.',
      'No integration is set up for Notion yet.',
      'I am unable to connect to Slack from here.',
      "I can't reach the Google NotebookLM account.",
    ]) {
      expect(contradictsReality(said, REACH), said).not.toBeNull()
    }
  })

  it('allows the true and useful sentence about a search', () => {
    // The distinction the whole file exists for: our records holding nothing is
    // hers to report, and the wiring is not.
    for (const said of [
      'I could not find anything about that in Notion.',
      'There is nothing on it in Notion that I can see — where should I be looking?',
      'Nothing in our records matched. Do you have a link?',
      'I searched Notion and came up empty.',
    ]) {
      expect(contradictsReality(said, REACH), said).toBeNull()
    }
  })

  it('allows a denial about something genuinely unreachable', () => {
    // GitHub really is limited, so saying so is correct and must not be caught.
    expect(
      contradictsReality('I cannot get access to that GitHub repository yet.', REACH),
    ).toBeNull()
  })

  it('ignores a service the reply never mentions', () => {
    expect(contradictsReality('I have no idea, sorry.', REACH)).toBeNull()
  })
})

describe('the brief handed to the model', () => {
  it('names what is reachable and what is not, with the reason', () => {
    const brief = capabilityBrief(able())
    expect(brief).toContain('Notion')
    expect(brief).toContain('Slack')
    expect(brief).toContain('no read token for other repos')
  })

  it('draws the distinction that was collapsed', () => {
    const brief = capabilityBrief(able()).toLowerCase()
    expect(brief).toContain('records hold nothing')
    expect(brief).toContain('not yours to make')
  })

  it('says nothing at all when it knows nothing', () => {
    expect(capabilityBrief(EMPTY_CAPABILITY)).toBe('')
  })
})

/*
  The sentence Grant was actually given.

  Issue #64. Claire: *"I cannot add interactive Telegram buttons; I only
  generate plain text. My replies stay limited to text…"* — false when she said
  it, and he then asked me to add a feature that already existed.

  It names no service, so the service scan in `contradictsReality` could never
  have caught it. That is the point of testing it separately.
*/
describe('claiming it can only send plain text', () => {
  const reach = [{ service: 'Notion', reachable: true, detail: null }]

  it('catches the exact sentence he was given', () => {
    expect(
      contradictsReality(
        'I cannot add interactive Telegram buttons; I only generate plain text.',
        reach,
      ),
    ).not.toBeNull()
  })

  it('catches the follow-on claim in the same message', () => {
    expect(contradictsReality('My replies stay limited to text.', reach)).not.toBeNull()
  })

  it('catches it phrased as an inability', () => {
    expect(contradictsReality('Sorry, I can not send buttons.', reach)).not.toBeNull()
  })

  it('leaves an honest sentence about text alone', () => {
    // "The document is plain text" is a fact about a document, not a claim
    // about what she can send. A guard that fires on it would train everyone
    // to ignore the guard.
    expect(
      contradictsReality('The transcript is plain text, so it imported cleanly.', reach),
    ).toBeNull()
  })

  it('and tells the truth in the brief, so it does not have to be caught', () => {
    const brief = capabilityBrief({ ...EMPTY_CAPABILITY, reach })
    expect(brief).toContain('thumbs up and thumbs down')
    expect(brief).toContain('Go ahead')
  })
})

/*
  What the brief says about a boundary (#148).

  Before this it said only what was reachable. An agent that does not know a
  tool exists cannot ask for it — ADR-0018 makes asking the correct move — and
  an agent that does not know a request was already refused asks again, which is
  how a boundary turns into a nag.
*/
describe('the brief and the boundary', () => {
  it('names the verbs a tool actually has, rather than only the tool', () => {
    const brief = capabilityBrief(
      able({
        can: [
          {
            tool: 'notion.write',
            what: 'Create and update Notion pages',
            verbs: ['create pages in any shared data source', 'set properties and relations'],
            inReply: true,
          },
        ],
      }),
    )
    expect(brief).toContain('create pages in any shared data source')
  })

  it('still names a tool that has no verbs recorded, rather than hiding it', () => {
    // Eighteen of twenty-one tools had no verb while the list lived in
    // TypeScript. Silence about them is what this replaced.
    const brief = capabilityBrief(
      able({ can: [{ tool: 'web.search', what: 'Search the web', verbs: [], inReply: true }] }),
    )
    expect(brief).toContain('web.search')
  })

  it('tells an agent to ASK for a tool the office holds and it does not', () => {
    const brief = capabilityBrief(
      able({ mustAsk: [{ tool: 'slack.post', what: 'Post to Slack', verbs: [], inReply: false }] }),
    )
    expect(brief).toContain('ask for one rather than saying it is impossible')
    expect(brief).toContain('slack.post')
  })

  it('says what is off for everyone, and the first clause of why', () => {
    const brief = capabilityBrief(
      able({
        cannot: [
          {
            tool: 'gmail.send',
            what: 'Send email',
            verbs: [],
            inReply: false,
            why: 'Destructive. Level 3.',
          },
        ],
      }),
    )
    expect(brief).toContain('gmail.send')
    expect(brief).toContain('Destructive')
  })

  /*
    And not the whole registry entry.

    `tool_permissions.disabled_reason` is written for a person reading the
    registry -- `web.search`'s is 398 characters and recites migration 0298's
    argument. Nine of them were 2,027 characters of a brief that goes in front
    of every answer, which had reached 5,183 against the 4,000 ceiling
    `verify:capability` has asserted all along.

    Asserted as a PROPERTY rather than as the exact truncation: a clause
    survives, the essay does not, and the sentence still names the tool. A test
    that pinned the cut at 56 characters would be the wording lock this
    repository has now recorded six times.
  */
  it('does not put the whole registry reason in front of every answer', () => {
    const essay =
      'Nothing implements this. The row claimed reach the office does not have, ' +
      'and every agent was told it could search the web on the strength of it.'
    const brief = capabilityBrief(
      able({
        cannot: [{ tool: 'web.search', what: 'Search', verbs: [], inReply: false, why: essay }],
      }),
    )
    expect(brief).toContain('web.search')
    expect(brief).toContain('Nothing implements this')
    expect(brief).not.toContain('every agent was told')
    expect(brief.length).toBeLessThan(essay.length + 1_800)
  })

  /*
    CONTROL. A reason with no sentence end still has to be cut, or the cap is
    doing nothing for the two registry entries that have no full stop until
    well past two hundred characters.
  */
  it('CONTROL: cuts a reason that never ends a sentence', () => {
    const runOn = `${'a'.repeat(300)}`
    const brief = capabilityBrief(
      able({
        cannot: [{ tool: 'db.delete', what: 'Delete', verbs: [], inReply: false, why: runOn }],
      }),
    )
    expect(brief).not.toContain(runOn)
    expect(brief).toContain('…')
  })

  it('says what was already refused, so it is not asked for twice', () => {
    const brief = capabilityBrief(able({ declined: [{ tool: 'github.write', why: 'not in V1' }] }))
    expect(brief).toContain('do not ask again')
    expect(brief).toContain('github.write')
    expect(brief).toContain('not in V1')
  })

  it('says none of it when there is nothing to say', () => {
    // A brief padded with empty headings is one a model learns to skim.
    const brief = capabilityBrief(able())
    expect(brief).not.toContain('ask for one rather than')
    expect(brief).not.toContain('Switched off for everyone')
    expect(brief).not.toContain('do not ask again')
  })
})
