/**
 * #246 — user-facing output must be an answer, not the working.
 *
 * Permanent regressions for the invariant the hostile corpus found missing.
 * Deliberately NOT the corpus's own sentences: those are in
 * `scripts/verify/answers.ts` as the exact-shape regression, and a check whose
 * only cases are the ones that caught it is a check that catches exactly one
 * bug. These are semantic neighbours — the same three shapes said differently,
 * in other domains, by other desks, at other lengths.
 *
 * The second describe block is the one that matters most. A form check is the
 * only gate here whose false positive costs a good answer, so the legitimate
 * cases outnumber the leaks and every one of them uses the vocabulary a naive
 * blacklist would have keyed on.
 */
import { describe, expect, it } from 'vitest'
import { deliberationLeak } from '../../src/agents/quality.ts'

const TOOLS = [
  'task.create',
  'db.read',
  'notebook.read',
  'notebook.write',
  'gmail.send',
  'gmail.search',
  'calendar.read',
  'slack.post',
  'notion.write',
  'web.search',
]

const leaks = (body: string): string | null => deliberationLeak(body, TOOLS)

describe('#246 — planning out loud instead of answering', () => {
  it('catches a plan naming a tool, in the first person plural', () => {
    expect(leaks('We should invoke calendar.read and see what Thursday looks like.')).not.toBeNull()
  })

  it('catches it in the first person singular too', () => {
    expect(leaks('I will query db.read for the churn figure and then summarise.')).not.toBeNull()
  })

  it('catches a plan about the tool description rather than a named tool', () => {
    expect(
      leaks('According to the tool description we can request a summary, so we will try that.'),
    ).not.toBeNull()
  })

  it('catches deliberation about missing parameters', () => {
    expect(leaks('We need parameters: owner? Not supplied. We could guess.')).not.toBeNull()
  })

  it('catches a bare attempt line', () => {
    expect(leaks('Attempt notebook.write with the summary text.')).not.toBeNull()
  })

  it('catches the model addressing itself about what to say', () => {
    expect(leaks("Let's respond with a short paragraph and use gmail.search first.")).not.toBeNull()
  })

  it('catches a plan buried after a legitimate opening', () => {
    // The dangerous shape: it starts like an answer.
    expect(
      leaks(
        'Thanks — the renewal is on the 14th. We need to call task.create for the chase, ' +
          'but the project is not given, so maybe use a generic one.',
      ),
    ).not.toBeNull()
  })
})

describe('#246 — call syntax in the answer', () => {
  it('catches tool-call JSON on its own', () => {
    expect(leaks('{"tool": "calendar.read", "parameters": {"day": "Thursday"}}')).not.toBeNull()
  })

  it('catches tool-call JSON after a friendly sentence', () => {
    // Measured shape: the model says something human and then emits the call.
    expect(
      leaks('Pulling that up for you now. { "name": "db.read", "arguments": { "q": "churn" } }'),
    ).not.toBeNull()
  })

  it('catches a call written as prose with named arguments', () => {
    expect(
      leaks('I have asked the team. notion.write(page="Pricing", body="see thread")'),
    ).not.toBeNull()
  })

  it('catches an arguments block with no tool key', () => {
    expect(
      leaks('Sending it: { "arguments": { "to": "supplier", "when": "Friday" } }'),
    ).not.toBeNull()
  })
})

describe('#246 — a raw token stream rather than writing', () => {
  it('catches sentences fused with no space, twice or more', () => {
    expect(
      leaks('Checked the notebook.Nothing there about pricing.Will ask Emma instead.'),
    ).not.toBeNull()
  })

  it('leaves a single fusion alone, because one is a typo', () => {
    expect(leaks('I checked the notebook.Nothing there about pricing this quarter.')).toBeNull()
  })
})

describe('#246 — legitimate prose is not touched', () => {
  // Grant's condition, case by case. Every one of these contains a word a
  // phrase blacklist would have fired on.
  const FINE: readonly [string, string][] = [
    ['need, as an ordinary verb', 'We need to raise the middle tier before renewal.'],
    ['need, about information', 'I need the variable cost per unit before I can model it.'],
    ['must, about an obligation', 'You must give thirty days notice, so the earliest is the 14th.'],
    ['policy, quoted at Grant', 'According to policy the refund window is fourteen days.'],
    [
      'according to, about his own figures',
      'According to the numbers you gave me that is about 780 a quarter.',
    ],
    ['parameters, as a modelling word', 'The model has three parameters: price, volume and churn.'],
    [
      'will call, about a person',
      'I will call the supplier tomorrow and ask for the revised quote.',
    ],
    ['use, about a document', 'We should use the older figures until the new ones are signed off.'],
    ['the spec, meaning his document', 'The spec you sent says two weeks to onboard.'],
    ['attempt, as a plain verb', 'I attempted the reconciliation twice and both runs agreed.'],
    ['a question to Grant', 'Do we need a second approver, or is one enough at this size?'],
    [
      'a plan with no machinery at all',
      'We should query the supplier about the discount before Friday.',
    ],
    [
      'an honest refusal, in his words',
      'I cannot send email from here, so I have written you a draft instead.',
    ],
    [
      'a capability statement naming nothing',
      'Searching the web is switched off for everyone in the office.',
    ],
    ['a decimal', 'Revenue was 1.2m last quarter, up from 0.9m.'],
    ['an initial', 'The lead is J. Patel and she signed it off on Tuesday.'],
    ['a domain', 'Their pricing page is at supplier.example with three tiers on it.'],
    [
      'a long answer with several of the words',
      'According to the contract you must give notice, and we need to decide this week. ' +
        'The parameters are the same as last time: price, term and volume. I will call them Friday.',
    ],
    ['an empty body', ''],
    ['a one-word answer', 'Yes.'],
  ]

  for (const [label, body] of FINE) {
    it(`leaves alone: ${label}`, () => {
      expect(leaks(body)).toBeNull()
    })
  }
})

describe('#246 — the machinery half is data, not a hardcoded list', () => {
  it('a tool the office has not registered is not machinery', () => {
    // The same sentence with a name nothing in tool_permissions knows is
    // ordinary prose, and must stay ordinary prose.
    expect(deliberationLeak('We need to use widget.frobnicate for that.', TOOLS)).toBeNull()
  })

  it('and becomes machinery the moment it is registered', () => {
    expect(
      deliberationLeak('We need to use widget.frobnicate for that.', [
        ...TOOLS,
        'widget.frobnicate',
      ]),
    ).not.toBeNull()
  })

  it('call syntax and token bleed are caught with no tool list at all', () => {
    expect(deliberationLeak('{"tool": "x.y", "arguments": {}}')).not.toBeNull()
    expect(deliberationLeak('Did that.Then this.And also that.')).not.toBeNull()
  })
})
