/**
 * "Remind me to write the one-pager" is a reminder, not a one-pager (#325).
 *
 * `artifactRequest` and `personalTaskRequest` both fire on that sentence —
 * on Grant's own words, with no resolver involved — and the artifact reading
 * was taken first and vetoed the task outright. So the office produced the
 * document and never added the reminder: the one response that defeats the
 * request, because he had just said when he wanted to do it and it was not
 * now.
 *
 * The mood of a sentence is set by its main clause. This repository has paid
 * for that three times already — a complement clause read as a condition, a
 * delegation's span read as three separate intents, and "suggest when we
 * should decide" filed as a standing procedure.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { artifactRequest } from '../../src/agents/actions.ts'
import { personalTaskRequest } from '../../src/agents/mine.ts'

describe('the two readings genuinely collide', () => {
  /*
    Stated as a fact about the recognisers rather than assumed, because the
    fix is a PRECEDENCE and a precedence over an empty overlap is dead code —
    the parameter no caller passes, one layer up.
  */
  it.each([
    'Remind me to write the one-pager for the venue change',
    'Add a task for me to write up the pricing report',
  ])('%j is read as both an artifact request and a personal task', (said) => {
    expect(artifactRequest(said)).not.toBeNull()
    expect(personalTaskRequest(said)).not.toBeNull()
  })

  it('while a plain request for a file is only ever the file', () => {
    expect(artifactRequest('Write me a one-pager on the venue change')).not.toBeNull()
    expect(personalTaskRequest('Write me a one-pager on the venue change')).toBeNull()
  })

  it('and a reminder with no making in it is only ever the reminder', () => {
    const said = 'Remind me on Friday to ring the caterers'
    expect(artifactRequest(said)).toBeNull()
    expect(personalTaskRequest(said)).not.toBeNull()
  })
})

describe('and the office resolves it towards the deferral', () => {
  it('a deferral he stated outranks the artifact reading', async () => {
    const text = await readFile(
      new URL('../../src/handlers/instruction.ts', import.meta.url),
      'utf8',
    )
    const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    /*
      The wired expression, not the name. A test asserting only that
      `deferred` is declared stays green when its value is replaced by null —
      three vacuous controls in this repository passed exactly that way.
    */
    expect(withoutComments).toMatch(
      /const deferred = isBranch \? null : firstOfHis\(personalTaskRequest\)/,
    )
    /*
      The guard the artifact reader actually falls through, bounded at both
      ends. Written as one pinned expression this went red when a second
      condition joined it (#316's repeat gate) — the wording lock again.
    */
    const at = withoutComments.indexOf('firstOf(artifactRequest)')
    expect(at).toBeGreaterThan(-1)
    expect(withoutComments.slice(withoutComments.lastIndexOf('const ', at), at)).toContain(
      'deferred !== null',
    )
  })
})
