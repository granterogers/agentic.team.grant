/**
 * Reading a link the way a colleague would, as cases.
 *
 * The first block is Grant's own example. The rest are the ways the same
 * message arrives when someone is typing on a phone.
 */
import { describe, expect, it } from 'vitest'
import { classifyLink, linkRequest } from '../../src/agents/links.ts'

describe('what a link is', () => {
  it('recognises a notebook and keeps its id, not its url', () => {
    // Keyed on the id because one notebook has several urls — trailing slash,
    // `?authuser=1` — and attaching by url would attach it twice.
    const a = classifyLink(
      'https://notebooklm.google.com/notebook/326f2817-ea20-494b-82ac-8cdc602249e0',
    )
    const b = classifyLink(
      'https://notebooklm.google.com/notebook/326f2817-ea20-494b-82ac-8cdc602249e0/?authuser=1',
    )
    expect(a.kind).toBe('notebooklm')
    expect(a.ref).toBe(b.ref)
  })

  it('recognises a Notion page by its id', () => {
    const l = classifyLink(
      'https://www.notion.so/grant/Coaching-Research-1f2e3d4c5b6a70819273645566778899',
    )
    expect(l.kind).toBe('notion')
    expect(l.ref).toBe('1f2e3d4c5b6a70819273645566778899')
  })

  it('recognises YouTube in all the shapes people send it', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=abc123',
      'https://youtu.be/abc123',
      'https://www.youtube.com/shorts/abc123',
    ]) {
      expect(classifyLink(url).kind, url).toBe('youtube')
    }
  })

  it('treats anything else as a plain link', () => {
    expect(classifyLink('https://en.wikipedia.org/wiki/Coaching').kind).toBe('web')
  })

  it('strips the punctuation a sentence leaves stuck to a url', () => {
    expect(classifyLink('https://example.com/a.').url).toBe('https://example.com/a')
    expect(classifyLink('(https://example.com/b)').url).toBe('(https://example.com/b')
  })
})

describe('what the sender wants done with it', () => {
  it('reads Grant’s own example', () => {
    const r = linkRequest('Add this to the project https://www.youtube.com/watch?v=abc123')
    expect(r?.intent).toBe('add_source')
    expect(r?.links[0]?.kind).toBe('youtube')
  })

  it('treats a bare notebook link as a place to attach', () => {
    // Nobody sends you a link to a notebook meaning "read this notebook".
    const r = linkRequest(
      'https://notebooklm.google.com/notebook/326f2817-ea20-494b-82ac-8cdc602249e0',
    )
    expect(r?.intent).toBe('attach')
  })

  it('treats a bare content link as something to add', () => {
    const r = linkRequest('https://en.wikipedia.org/wiki/Coaching')
    expect(r?.intent).toBe('add_source')
  })

  it('does not act on a link someone is asking about', () => {
    expect(linkRequest('what do you think of https://example.com/x')?.intent).toBe('discuss')
    expect(linkRequest('have a look at https://example.com/x')?.intent).toBe('discuss')
  })

  it('still acts when the instruction has a pleasantry in front of it', () => {
    // "Have a look at this and add it" is an instruction, not a question.
    expect(linkRequest('have a look at https://example.com/x and add it')?.intent).toBe(
      'add_source',
    )
  })

  it('is null for a message with no link at all', () => {
    expect(linkRequest('add that to the project')).toBeNull()
  })
})

describe('which project', () => {
  it('reads a quoted name', () => {
    expect(linkRequest('add https://example.com/x to "Coaching Research"')?.namedProject).toBe(
      'coaching research',
    )
  })

  it('reads "to the X project"', () => {
    expect(
      linkRequest('add https://example.com/x to the coaching research project')?.namedProject,
    ).toBe('coaching research')
  })

  it('does not mistake a destination for a project name', () => {
    // "the notebook" is where it goes, not which project it belongs to.
    // Guessing here files a source somewhere plausible and wrong, which is
    // invisible: it is present, searchable, and answers the wrong questions.
    expect(linkRequest('add https://example.com/x to the notebook')?.namedProject).toBeNull()
  })

  it('says nothing when nothing was named', () => {
    expect(linkRequest('https://example.com/x')?.namedProject).toBeNull()
  })
})

describe('the grammar that is not a name', () => {
  it('reads "add this to the project" as naming no project', () => {
    // The first live message. It replied "I do not have a project called 'the'"
    // — because the optional `the` in the pattern backtracked and handed the
    // article over as the project's name.
    const r = linkRequest('Add this to the project https://www.youtube.com/watch?v=abc123')
    expect(r?.namedProject).toBeNull()
    expect(r?.intent).toBe('add_source')
  })

  it('rejects articles and destinations wherever they appear', () => {
    for (const text of [
      'add https://example.com/x to this project',
      'add https://example.com/x to the notebook project',
      'add https://example.com/x to "the"',
    ]) {
      expect(linkRequest(text)?.namedProject, text).toBeNull()
    }
  })

  it('still reads a real name in the same shape', () => {
    expect(linkRequest('add https://example.com/x to the coaching project')?.namedProject).toBe(
      'coaching',
    )
  })
})
