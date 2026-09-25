import { describe, expect, it } from 'vitest'
import { extractionRequest } from '../../src/agents/extract.js'

describe('a question about his own list is not an extraction (R38)', () => {
  it.each([
    'What tasks do I have this week?',
    'What needs doing today?',
    'List the tasks you have for this week.',
    'What are my tasks?',
    "What's overdue?",
    'What needs doing this week?',
    'What have I got on tomorrow?',
  ])('%s', (said) => {
    expect(extractionRequest(said)).toBeNull()
  })

  // Negative controls: extraction as he asks for it still reads the project.
  it.each([
    ['Pull the tasks out of the brief.', 'brief'],
    ['What are the actions in the venue contract?', 'venue contract'],
    ['Pull out the tasks due this week from the minutes.', 'minutes'],
  ])('%s is still an extraction from %s', (said, from) => {
    expect(extractionRequest(said)?.from).toBe(from)
  })
  it.each([
    'What needs doing on this project?',
    'Pull out all the actions.',
    'What are the next steps?',
  ])('%s is still a whole-project extraction', (said) => {
    expect(extractionRequest(said)).not.toBeNull()
    expect(extractionRequest(said)?.from).toBeNull()
  })
})
