/**
 * Reading Grant's actual voice note, as a case.
 *
 * The instruction below is the transcript of a real voice note, word for word,
 * including the way it runs on — because that is what arrives, and a planner
 * tested only on tidied-up sentences is a planner tested on nothing.
 */
import { describe, expect, it } from 'vitest'
import { describePlan, readPlan } from '../../src/agents/plan.ts'

const VOICE =
  'I want you to push this video into a new, into the notebook project called AI Learning, ' +
  'then find me the transcription and then report back to me here in Telegram, all the ' +
  'repositories that are mentioned and provide me the URLs such that I can investigate them ' +
  'here immediately. Thank you. https://youtu.be/9_SZFIW7tus'

describe('the voice note that asked for this', () => {
  it('reads all three intentions', () => {
    const plan = readPlan(VOICE)
    expect(plan).not.toBeNull()
    // `project`, not `create_project`. Whether it exists is a fact about the
    // world, and the planner does not touch the world — the handler resolves it
    // before the plan is shown. Grant already had a notebook called "AI
    // learning" and the first version made a second one beside it.
    expect(plan?.steps.map((s) => s.kind)).toEqual(['project', 'add_source', 'ask'])
  })

  it('takes the project name out of the middle of a run-on sentence', () => {
    const plan = readPlan(VOICE)
    const first = plan?.steps[0]
    expect(first?.kind).toBe('project')
    expect(first?.kind === 'project' && first.name).toBe('AI Learning')
  })

  it('puts the question last, after the source it is about', () => {
    // Not cosmetic. Asking before the video is transcribed gets a confident
    // answer about nothing.
    const plan = readPlan(VOICE)
    expect(plan?.steps.at(-1)?.kind).toBe('ask')
  })

  it('says it back numbered, quoting nothing it cannot do', () => {
    const said = describePlan(readPlan(VOICE) as never)
    expect(said).toContain('Let me say that back')
    expect(said).toContain('“AI Learning”')
    expect(said).toContain('youtu.be/9_SZFIW7tus')
    expect(said).toContain('Go ahead')
  })
})

describe('what is not a plan', () => {
  it('a single instruction is done, not proposed', () => {
    // One intention deserves action and a sentence, not a permission slip.
    expect(readPlan('Add this to the project https://youtu.be/abc123')).toBeNull()
    expect(readPlan('Make an audio overview in the notebook')).toBeNull()
  })

  it('creating a project does not by itself earn a plan', () => {
    // Scaffolding for whatever follows. "A new project called X" with nothing
    // to put in it is one intention.
    expect(readPlan('Start a new project called AI Learning')).toBeNull()
  })

  it('a question about a link is still just a question', () => {
    expect(readPlan('what do you think of https://youtu.be/abc123')).toBeNull()
  })

  it('does not mistake an existing project for a new one', () => {
    // "add this to the coaching project" names one that exists; creating a
    // second would split the corpus in two silently.
    const plan = readPlan(
      'Add https://youtu.be/abc123 to the coaching project and tell me what repositories it mentions',
    )
    expect(plan?.steps.some((s) => s.kind === 'project')).toBe(false)
    expect(plan?.project).toBe('coaching')
  })
})

describe('the other shapes it handles', () => {
  it('a source plus an artifact', () => {
    const plan = readPlan(
      'Add https://youtu.be/abc123 to a new project called Research and make an audio overview',
    )
    expect(plan?.steps.map((s) => s.kind)).toEqual(['project', 'add_source', 'generate'])
  })

  it('an attachment plus a question', () => {
    const plan = readPlan(
      'Attach https://notebooklm.google.com/notebook/326f2817-ea20-494b-82ac-8cdc602249e0 ' +
        'and tell me what it says about pricing',
    )
    expect(plan?.steps.map((s) => s.kind)).toEqual(['attach', 'ask'])
  })
})

describe('the question it puts to the notebook', () => {
  it('asks about the content, not about the plan', () => {
    // The first version passed the whole instruction, and the notebook
    // answered the INSTRUCTION: "I cannot create a new notebook project called
    // 'AI Learning', push videos to other projects, or send messages to
    // Telegram." Reasonable, and useless.
    const plan = readPlan(VOICE)
    const ask = plan?.steps.at(-1)
    expect(ask?.kind).toBe('ask')
    const question = ask?.kind === 'ask' ? ask.question : ''
    expect(question).not.toMatch(/new notebook project/i)
    expect(question).not.toMatch(/https?:/)
    expect(question).not.toMatch(/thank you/i)
    expect(question.toLowerCase()).toContain('repositories')
  })

  it('falls back to the whole instruction rather than asking nothing', () => {
    // A bad question beats no question: the answer is at least about the
    // sources, and Grant can see what was asked.
    const plan = readPlan('Add https://youtu.be/abc123 and list the repositories')
    const ask = plan?.steps.at(-1)
    expect(ask?.kind === 'ask' && ask.question.length).toBeGreaterThan(11)
  })
})

describe('never proposing to create without saying so loudly', () => {
  it('marks a genuine creation with a warning, not a bland line', () => {
    // Grant: "please don't assume I wish to create a new project. This is a
    // large task and should always be confirmed." A line that reads the same
    // whether it is adopting or creating is a line he will approve without
    // noticing which.
    const plan = readPlan(VOICE) as never
    const created = {
      ...(plan as { steps: unknown[] }),
      steps: [{ kind: 'create_project', name: 'AI Learning' }],
    }
    const said = describePlan(created as never)
    expect(said).toContain('BRAND NEW')
    expect(said).toContain('you have nothing by that name')
  })

  it('says plainly when it is using one that exists', () => {
    const used = {
      steps: [{ kind: 'use_project', name: 'AI learning', notebookRef: 'nb-1' }],
      project: 'AI learning',
      instruction: 'x',
    }
    expect(describePlan(used as never)).toContain('Use your existing')
  })
})

describe('a project named without the word "new"', () => {
  it('is still a project step, so the resolver decides', () => {
    // What Grant actually says when he means one he already has. The first
    // version matched only "a NEW project called X", emitted no project step,
    // and silently used whichever project the message had been filed under.
    const plan = readPlan(
      'Push this video into the notebook project called AI learning, then tell me all ' +
        'the repositories mentioned with URLs. https://youtu.be/9_SZFIW7tus',
    )
    expect(plan?.steps.map((s) => s.kind)).toEqual(['project', 'add_source', 'ask'])
    const first = plan?.steps[0]
    expect(first?.kind === 'project' && first.name).toBe('AI learning')
  })

  it('reads the same whichever way he phrases it', () => {
    for (const text of [
      'add https://youtu.be/x to the project called Research and summarise it',
      'add https://youtu.be/x to a new project called Research and summarise it',
    ]) {
      const first = readPlan(text)?.steps[0]
      expect(first?.kind, text).toBe('project')
      expect(first?.kind === 'project' && first.name, text).toBe('Research')
    }
  })
})
