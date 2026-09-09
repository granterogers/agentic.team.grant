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

describe('a brief is not a request for one artifact', () => {
  /*
    The real thing, word for word. Grant sent this to the Chief of Staff on
    2026-09-09 to watch the team handle a multi-part job. It contains the word
    "create" and, inside a parenthesis listing things to fetch, the phrase
    "audio overviews" — so both patterns matched and twenty-five lines became a
    single request to generate an audio overview, in the wrong project.

    Nothing was made: the approval gate asked first. But it was one tap away.
  */
  const BRIEF = [
    'Take the "Legacy Coaching Course" notebook in our Google notebook account',
    '(id 8c9022a1-d2bc-4231-b2c6-5adf363929ec, 12 sources) and use it to fully',
    'populate the corresponding Notion teamspace.',
    '',
    'What I want:',
    '- Read the whole notebook, all 12 sources.',
    '- Work out the coaching curriculum from what is in there, and break the',
    '  teamspace down into Notion Projects along that curriculum.',
    '- Create the tasks that follow from it.',
    '- Write the documents up properly in Notion format so they are easy to read',
    '  there. Structured pages, not dumps of source text.',
    '- Pull the files the notebook has generated (audio overviews and the like)',
    '  and put them into Notion too.',
    '',
    'Check what already exists before creating anything, and do not make a second',
    'copy of something we already have.',
  ].join('\n')

  it('does not read a twenty-five-line brief as one artifact request', () => {
    expect(notebookRequest(BRIEF)).toBeNull()
  })

  it('ignores an artifact named as an example rather than asked for', () => {
    // The parenthesis is the tell. Same sentence, no brief around it.
    expect(
      notebookRequest('Pull the files it has generated (audio overviews and the like) into Notion'),
    ).toBeNull()
    expect(notebookRequest('Grab anything it made, such as an audio overview')).toBeNull()
  })

  it('still reads the short request it was written for', () => {
    // The guards must not cost the case this table exists for.
    const asked = notebookRequest('Generate an audio overview in our Google notebook for this project')
    expect(asked?.kinds).toEqual(['audio'])
  })

  it('still reads two artifacts asked for in one short sentence', () => {
    const asked = notebookRequest('make an audio overview and a slide deck in the notebook')
    expect(asked?.kinds).toEqual(['audio', 'slides'])
  })

  it('counts bullets, sentences and lines — any one of them is enough', () => {
    // Three bullets is a list of asks, whatever else is true of the text.
    const bulleted = 'Make an audio overview\n- one\n- two\n- three'
    expect(notebookRequest(bulleted)).toBeNull()
    // And a wall of sentences with no bullets at all.
    const wordy =
      'Make an audio overview. Then check the numbers. Then tell Emma. ' +
      'Then file it. Then close the task. Then let me know.'
    expect(notebookRequest(wordy)).toBeNull()
  })
})
