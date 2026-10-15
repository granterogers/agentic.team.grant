import { describe, expect, it } from 'vitest'
import { artifactRequest } from '../../src/agents/actions.ts'
import { asksForTasks } from '../../src/agents/goal.ts'
import { classifyIntent, needsClarification } from '../../src/agents/intent.ts'

/*
  The Canary Coworking request, as Grant said it (15 October 2026, 09:34, the transcript in
  docs/reliability/chief-of-staff-incident.md), read by the pure readers that decide whether the office asks a question
  and what it sets up. No model, no database: this is the part of priority 1 that is decided before any model answers.

  Priority 1 (COS-121, COS-122, COS-123): the request must not be stopped by a question about a Gmail term, a Notion
  workspace or a task owner. The negative control shows the clarification reader can still ask when it should.
*/
const canary =
  "I want you to create a new project, we can call it the Canary Coworking Project and basically I'm trying to do some investigations of where I can do some co-living in the Canary Islands. There's already a bunch of emails that I've sent out and got some replies So I need you to scan my Gmail and start to put together the summaries of the replies from each of the people You know, produce a summary document as well Create tasks based on if anything requires a reply Yeah, that's probably enough for now Yeah, and basically, you know, need some documents created that summarise the prices, locations What places are not available, what places are available That kind of thing"

describe('the Canary request is understood without a question', () => {
  it('the reader does not stop it to ask for a Gmail term, a Notion workspace or an owner', () => {
    expect(needsClarification(classifyIntent(canary))).toBe(false)
  })

  it('the request to create tasks is recognised (follow-ups are a deliverable, not a question)', () => {
    expect(asksForTasks(canary)).toBe(true)
  })

  it('the request for a summary document is recognised as an artifact request', () => {
    expect(artifactRequest(canary)).not.toBeNull()
  })
})

describe('controls: the reader still asks when it should, and a mention of a document is not a request for one', () => {
  it('a request it cannot read is still a question', () => {
    expect(needsClarification(classifyIntent('zxq flumph'))).toBe(true)
  })

  it('a document someone else sent, asked about, is not a request to make one', () => {
    expect(artifactRequest('Did you see the summary document Elena sent?')).toBeNull()
  })

  it('a request to look at a document that exists is not a request to make another', () => {
    expect(artifactRequest('Please check the summary document')).toBeNull()
  })
})
