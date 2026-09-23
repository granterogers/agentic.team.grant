/**
 * The office must not say it cannot do something it can (#320).
 *
 * ## The answer this is written against
 *
 * Grant asked for a better version of a PDF the office had just made him, and
 * got back:
 *
 *   > *"I can't create a PDF directly in Telegram, but I'll build a fully
 *   > formatted Notion page with sections, charts and image placeholders; you
 *   > can then export it as a PDF."*
 *
 * `artifact.report` had produced 139 PDFs by then. It was not a hallucination:
 * no `tool_permissions` row named the handler, so `capabilityBrief` never told
 * any agent the office could do it, and the model was reading its brief.
 *
 * ## What these tests hold
 *
 * The detector reads CANONICAL CAPABILITY STATE, not a list of sentences. The
 * control that matters is the third one down: the same words, with the
 * capability switched off in the registry, must stop being a defect. If that
 * test passes while the registry is ignored, the detector is a phrase list
 * wearing a costume.
 *
 * And the four states stay apart. "I can't" covers a capability that is off, a
 * capability that needs information, an attempt that failed, and a lie — and
 * only the last is a defect. Collapsing them would make the office either
 * mute or dishonest.
 */

import { describe, expect, it } from 'vitest'
import type { Capability } from '../../src/agents/capability.ts'
import { capabilityClaims, capabilityLies } from '../../src/agents/capability-claims.ts'

/** A registry with one held capability for making PDFs, and nothing else. */
const office = (over: Partial<Capability> = {}): Capability => ({
  reach: [{ service: 'Telegram', reachable: true, detail: null }],
  can: [
    {
      tool: 'document.create',
      what: 'Produce a finished, typeset PDF document and deliver it on the channel that asked',
      verbs: ['produce a real PDF and deliver it on this channel'],
      inReply: true,
    },
  ],
  mustAsk: [],
  cannot: [],
  declined: [],
  ...over,
})

describe('a denial is checked against what the office actually holds', () => {
  it('catches the sentence Grant was given', () => {
    const found = capabilityLies(
      "I can't create a PDF directly in Telegram, but I'll build a Notion page instead.",
      office(),
    )
    expect(found.map((f) => f.verdict)).toEqual(['false_denial'])
    expect(found[0]?.tool).toBe('document.create')
  })

  it('catches phrasings nobody wrote it against', () => {
    for (const said of [
      'I am not able to produce a PDF for you.',
      "Unfortunately I don't have the means to make a PDF.",
      'We cannot generate a typeset PDF from here.',
      /*
        No modal at all, and the office says it in its own voice.

        `blocked_capability` in `src/agents/outcome.ts` composes exactly this:
        *"I have not done this, and it is not something I can do — so there is
        nothing to wait for."* Every other pattern here keys on can't / cannot
        / unable, so the office's own canonical way of refusing a capability
        was the one shape the detector could not see. Found by driving the
        live suite, not by reading.
      */
      'I have not done this, and making a PDF is not something I can do.',
      'A typeset PDF is beyond what I can do from here.',
    ]) {
      expect(capabilityLies(said, office()), said).toHaveLength(1)
    }
  })

  /*
    THE CONTROL THE WHOLE FILE EXISTS FOR.

    Identical words. The capability moved from `can` to `cannot` in canonical
    state, and the verdict must follow the registry rather than the sentence.
    A detector that still calls this a lie is reading a phrase list.
  */
  it('stops being a defect when the registry says the capability is off', () => {
    const off = office({
      can: [],
      cannot: [
        {
          tool: 'document.create',
          what: 'Produce a finished, typeset PDF document and deliver it on the channel that asked',
          verbs: [],
          inReply: false,
          why: 'no renderer is deployed',
        },
      ],
    })
    const said = "I can't create a PDF directly in Telegram."
    expect(capabilityLies(said, off)).toHaveLength(0)
    expect(capabilityClaims(said, off).map((c) => c.verdict)).toEqual(['cannot'])
  })

  it('and when the service behind it is unreachable', () => {
    const down = office({
      reach: [{ service: 'Telegram', reachable: false, detail: 'token_expired' }],
      can: [
        {
          tool: 'telegram.post',
          what: 'Send a message on Telegram',
          verbs: [],
          inReply: true,
        },
      ],
    })
    expect(
      capabilityClaims("I can't send anything on Telegram.", down).map((c) => c.verdict),
    ).toEqual(['cannot'])
  })
})

describe('the four states do not collapse into one refusal', () => {
  it('missing information is not a lie', () => {
    const said = "I can't make the PDF without knowing which project you mean."
    expect(capabilityLies(said, office())).toHaveLength(0)
    expect(capabilityClaims(said, office()).map((c) => c.verdict)).toEqual(['needs_something'])
  })

  it('a capability the office holds and this person does not is asked for, not denied', () => {
    const askable = office({
      can: [],
      mustAsk: [
        {
          tool: 'document.create',
          what: 'Produce a finished, typeset PDF document and deliver it on the channel that asked',
          verbs: [],
          inReply: false,
        },
      ],
    })
    expect(
      capabilityClaims("I can't create a PDF for you.", askable).map((c) => c.verdict),
    ).toEqual(['needs_something'])
  })

  it('an attempt that failed is not a lie', () => {
    const said = 'I tried to produce the PDF and it failed, so I cannot send one.'
    expect(capabilityLies(said, office())).toHaveLength(0)
  })

  it('a capability the office performs on a schedule cannot be performed in a reply', () => {
    const scheduled = office({
      can: [
        {
          tool: 'document.create',
          what: 'Produce a finished, typeset PDF document and deliver it on the channel that asked',
          verbs: [],
          inReply: false,
        },
      ],
    })
    expect(
      capabilityClaims("I can't create a PDF right now.", scheduled).map((c) => c.verdict),
    ).toEqual(['cannot'])
  })
})

describe('sentences that are true, and must never be corrected', () => {
  it('an absence in the records is a statement about a search', () => {
    for (const said of [
      "I don't have any record of a PDF for that project.",
      'There is nothing on that in our documents.',
      "I can't find a PDF anywhere in the project.",
    ]) {
      expect(capabilityLies(said, office()), said).toHaveLength(0)
    }
  })

  it('not knowing something is not being unable to do it', () => {
    expect(
      capabilityLies("I can't confirm whether their PDF export is any good.", office()),
    ).toHaveLength(0)
  })

  it('a denial about somebody else is not a denial about us', () => {
    expect(
      capabilityLies(
        "If the bought solutions can't produce a PDF, we should look elsewhere.",
        office(),
      ),
    ).toHaveLength(0)
  })

  it('an offer is not a denial, even in a sentence that opens with one', () => {
    const found = capabilityClaims(
      "I can't reach Notion, but I'll produce a PDF instead.",
      office(),
    )
    expect(
      found.filter((f) => f.tool === 'document.create' && f.verdict === 'false_denial'),
    ).toHaveLength(0)
  })
})

describe('the other direction: offering what nothing can perform', () => {
  it('offering a capability that is switched off for everyone is a defect', () => {
    const off = office({
      cannot: [
        {
          tool: 'web.search',
          what: 'Search the internet and read what comes back',
          verbs: [],
          inReply: false,
          why: 'nothing implements it',
        },
      ],
    })
    const found = capabilityLies("I'll search the internet and come back to you.", off)
    expect(found.map((f) => f.verdict)).toEqual(['false_offer'])
    expect(found[0]?.tool).toBe('web.search')
  })

  it('but offering one the office holds is ordinary', () => {
    expect(capabilityLies("I'll produce a PDF for you now.", office())).toHaveLength(0)
  })
})

describe('the detector declines rather than guessing', () => {
  it('says nothing about an office with no capabilities at all', () => {
    const empty: Capability = { reach: [], can: [], mustAsk: [], cannot: [], declined: [] }
    expect(capabilityClaims("I can't create a PDF.", empty)).toHaveLength(0)
  })

  it('says nothing about an empty answer', () => {
    expect(capabilityClaims('', office())).toHaveLength(0)
  })
})

describe('and the handler actually consults it', () => {
  /*
    Assert the CALL, not the NAME.

    CLAUDE.md records three vacuous controls in one session, all of the same
    shape: `expect(source).toContain('capabilityLies')` stays green when the
    expression is replaced by `null`, because the import still names the
    function. What discriminates is the wired expression with its arguments —
    a sabotage that guts the correction has to remove it.

    A source assertion because the alternative is a live model call. The
    behaviour itself is proved by the calibration run in the commit and by
    `verify:capability` against the deployed worker.
  */
  it('the correction reads the answer against this turn’s capability state', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/handlers/instruction.ts', 'utf8'),
    )
    expect(source).toContain('capabilityLies(said, cap)')
  })
})
