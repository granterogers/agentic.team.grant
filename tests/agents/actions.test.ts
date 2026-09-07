/**
 * The table that turns a sentence into a job, as cases.
 *
 * Every line here is a phrasing that either did or plausibly could arrive in a
 * Telegram chat. The first one is the message Grant actually sent, which
 * produced a paragraph about audio overviews instead of an audio overview —
 * this file exists so that cannot happen again quietly.
 */
import { describe, expect, it } from 'vitest'
import { KIND_LABEL, notebookRequest } from '../../src/agents/actions.ts'

describe('reading an instruction as a request to make something', () => {
  it('reads the message that exposed the gap', () => {
    const r = notebookRequest('Generate an audio overview in our Google notebook for this project.')
    expect(r?.kinds).toEqual(['audio'])
  })

  it('reads a slide deck', () => {
    expect(notebookRequest('Make a slide deck about the coaching programme')?.kinds).toEqual([
      'slides',
    ])
  })

  it('reads two artifacts in the order they were asked for', () => {
    const r = notebookRequest('Create an audio overview and then a slide deck for this')
    expect(r?.kinds).toEqual(['audio', 'slides'])
  })

  it('takes a podcast to mean the audio overview', () => {
    expect(notebookRequest('Can you make a podcast of this?')?.kinds).toEqual(['audio'])
  })

  it('passes the whole instruction through as generation instructions', () => {
    const r = notebookRequest('Make a slide deck, ten slides, no jargon')
    expect(r?.instructions).toBe('Make a slide deck, ten slides, no jargon')
  })
})

describe('what it refuses to read as a request', () => {
  it('ignores a question about an artifact', () => {
    expect(notebookRequest('What is an audio overview?')).toBeNull()
    expect(notebookRequest('Did you make the slide deck yet?')).toBeNull()
    expect(notebookRequest('Do we have a report in the notebook?')).toBeNull()
  })

  it('ignores a sentence with no verb of making', () => {
    expect(notebookRequest('The audio overview was quite good')).toBeNull()
  })

  it('leaves ordinary office work alone', () => {
    // The ambiguity that made the table two lists. "Write me a report" is the
    // team's normal work and must not silently become a notebook artifact.
    expect(notebookRequest('Draft a report on Q3 churn')).toBeNull()
    expect(notebookRequest('Prepare a quiz for the onboarding session')).toBeNull()
  })

  it('but takes those same nouns when the notebook is named', () => {
    expect(notebookRequest('Draft a report in NotebookLM on Q3 churn')?.kinds).toEqual(['report'])
    expect(notebookRequest('Make a study guide in the notebook')?.kinds).toEqual(['study_guide'])
  })
})

describe('the labels', () => {
  it('names every kind in a way a person would say it', () => {
    expect(KIND_LABEL.audio).toBe('audio overview')
    expect(KIND_LABEL.study_guide).toBe('study guide')
    for (const label of Object.values(KIND_LABEL)) expect(label).not.toMatch(/_/)
  })
})
