/**
 * A rule said with no project in hand is GLOBAL, not a rule about "unnamed".
 *
 * ## Why this is a source assertion
 *
 * The property needs a database — it is about what `app.unnamed_project()`
 * returns — so it is proved end to end by `npm run verify:preferences`. What
 * a unit test can hold is the WIRING, which is where the defect actually was
 * and where a future change would put it back.
 *
 * ## The defect, live on v707
 *
 * `inbound_commands.project_id` is NOT NULL and defaults to
 * `app.unnamed_project()`, so the handler never passes null: it passes the id
 * of a real row whose slug is `unnamed`. #310's first version tested
 * `projectId === null` and therefore stored every rule from a follow-up turn
 * at PROJECT scope, on a project called "unnamed":
 *
 *     project  fixture-sess-alpha-pref-said-twice  always give me your answers as clear bullet points
 *     project  unnamed                             Always give me your answers as clear bullet points
 *
 * Two rows for one rule, neither superseding the other, because a rule may
 * only replace one at its own scope. The second copy is exactly the thing
 * #310 exists to prevent, created by the fix for it.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/agents/remember.ts', 'utf8')
const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('the unnamed project is treated as no project', () => {
  it('asks the database which project is the unnamed one', () => {
    /*
      Against `app.unnamed_project(office)` rather than against a slug spelled
      out here: the office has one definition of that row and a second copy of
      it is how the two come to disagree. The property is that the row asked
      about is the OFFICE'S own catch-all (every office has one): the call
      names the office the rule is being stored in, and never the zero-argument
      form, which cannot tell one office's catch-all from another's.
    */
    expect(withoutComments).toMatch(/app\.unnamed_project\(\$\{officeOf\(office\)\}\)/)
    expect(withoutComments).not.toContain('app.unnamed_project()')
  })

  it('decides the scope from the resolved project, never from the argument', () => {
    /*
      The whole defect in one line. `projectId` is what the handler passed;
      `onAProject` is what it means. Every decision below must read the
      second.
    */
    expect(withoutComments).toMatch(/const scope = onAProject === null/)
    expect(withoutComments).toMatch(/const where = onAProject !== null/)
  })

  it('looks up and writes at that same resolved project', () => {
    /*
      A lookup at one project and a write at another would supersede nothing
      and duplicate everything, which is the failure mode this whole issue is
      about.
    */
    const learn = withoutComments.slice(withoutComments.indexOf('app.learn('))
    expect(learn.slice(0, 400)).toContain('uuid(onAProject)')
    const lookup = withoutComments.slice(withoutComments.indexOf('app.lessons_for('))
    expect(lookup.slice(0, 400)).toContain('uuid(onAProject)')
  })

  it('and only ever subtracts — a resolution failure cannot invent a project', () => {
    /*
      The catch returns null, so a database that cannot answer makes the rule
      GLOBAL rather than attaching it to a project nobody named. Failing open
      to the broader scope is the safe direction: a rule that applies too
      widely is visible in the say-back and correctable, and one silently
      attached to the wrong project is not.
    */
    expect(withoutComments).toMatch(/\.catch\(\(\) => null\)/)
  })
})
