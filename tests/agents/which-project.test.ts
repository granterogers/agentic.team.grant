/**
 * #416: a message that points at "this project" with no project to mean is asked about, never guessed.
 *
 * The recogniser is deliberately narrow, so these pin both directions: the shapes that must ask, and the neighbours that
 * must NOT (a request to start a project, a question about projects in general, a name already given, a bare question).
 */
import { describe, expect, it } from 'vitest'
import {
  pointsAtAProject,
  projectsToAskAbout,
  whichProjectQuestion,
} from '../../src/agents/which-project.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

describe('what points at a project without naming one', () => {
  it.each([
    "What's outstanding on this project?",
    'Summarise that project for me',
    'Who is on the current project',
    'Add a task to this project to chase the roofer',
    'How is the same project doing?',
    'Is our current project on track?',
  ])('asks: %s', (words) => {
    expect(pointsAtAProject(words)).toBe(true)
  })

  it.each([
    // Starting or naming a project is about projects in general, not about one in mind.
    'Create a new project called Garden',
    'Start a project for the autumn campaign',
    'Set up a project named Kitchen',
    'Make this a new project',
    // Listing projects
    'Which projects are open?',
    'What projects do we have this week',
    'Show me all my projects',
    // No project referenced at all
    "What's outstanding?",
    'Remind me to call Kevin tomorrow',
    // A name is not a pointer (the name resolves in enqueue_inbound instead)
    'How is the Japan Spring Trip going?',
    // "the project" alone is too ordinary a phrase to act on
    'I finished the project yesterday and it went well',
  ])('does not ask: %s', (words) => {
    expect(pointsAtAProject(words)).toBe(false)
  })
})

describe('the question', () => {
  it('lists what the person has, in their words, and says what happens next', () => {
    const q = whichProjectQuestion([
      '2027 Financial Plan',
      'Japan Spring Trip',
      'Wellness Studio Launch',
    ])
    expect(q).toMatch(/^Which project do you mean\?/)
    expect(q).toContain('“2027 Financial Plan”, “Japan Spring Trip” or “Wellness Studio Launch”')
    expect(q).toMatch(/pick it up from there/)
  })

  it('reads for two, and says nothing wrong for none', () => {
    expect(whichProjectQuestion(['A one', 'B two'])).toContain('“A one” or “B two”')
    expect(whichProjectQuestion([])).not.toMatch(/You have/)
  })

  it('carries no internal vocabulary', () => {
    expect(whichProjectQuestion(['Garden', 'Kitchen'])).not.toMatch(
      /unnamed|slug|job|office_id|context/i,
    )
  })
})

/** An executor that answers the one query this module makes, and records it. */
const db = (names: string[]) => {
  const seen: string[] = []
  const executor = {
    execute: async (sql: string) => {
      seen.push(sql)
      return { rows: names.map((name) => ({ name })) }
    },
  } as unknown as SqlExecutor
  return { executor, seen }
}

describe('when there is something to ask about', () => {
  it('never asks on a surface that states its own project', async () => {
    const { executor, seen } = db(['A one', 'B two'])
    expect(await projectsToAskAbout(executor, 'job-1', 'teamhq')).toBeNull()
    expect(await projectsToAskAbout(executor, 'job-1', 'voice')).toBeNull()
    expect(seen).toHaveLength(0)
  })

  it('asks on Telegram and Slack when two or more projects could be meant', async () => {
    const { executor } = db(['A one', 'B two'])
    expect(await projectsToAskAbout(executor, 'job-1', 'telegram')).toEqual(['A one', 'B two'])
    expect(await projectsToAskAbout(executor, 'job-1', 'slack')).toEqual(['A one', 'B two'])
  })

  it('does not ask when there is nothing to choose between', async () => {
    expect(await projectsToAskAbout(db(['Only one']).executor, 'job-1', 'telegram')).toBeNull()
    expect(await projectsToAskAbout(db([]).executor, 'job-1', 'telegram')).toBeNull()
  })

  it('looks only at the claimed job, in its own office, and only when the job is unscoped', async () => {
    const { executor, seen } = db(['A one', 'B two'])
    await projectsToAskAbout(executor, '11111111-1111-4111-8111-111111111111', 'telegram')
    const sql = seen[0] ?? ''
    expect(sql).toContain("j.job_id = '11111111-1111-4111-8111-111111111111'::uuid")
    expect(sql).toContain('p.office_id = j.office_id')
    expect(sql).toContain('j.project_id = app.unnamed_project(j.office_id)')
    expect(sql).toMatch(/not p\.is_fixture/)
  })
})
