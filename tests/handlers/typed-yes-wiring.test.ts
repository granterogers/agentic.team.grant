import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  #394 (Run 4): the typed yes asks ONE function which question he was shown. The rule lives in SQL
  (app.open_questions_for_reply, proved by scripts/isolated/typed-yes.ts); this asserts the handler still ASKS it
  - the wired call, not the name - and no longer carries its own copy of the query that could disagree.
*/
const src = readFileSync(new URL('../../src/handlers/instruction.ts', import.meta.url), 'utf8')

describe('the typed yes is bound by one function', () => {
  it("the handler calls app.open_questions_for_reply with this turn's command", () => {
    expect(src).toMatch(
      /from app\.open_questions_for_reply\(\$\{lit\(String\(payload\.command_id \?\? '[0-9-]{36}'\)\)\}::uuid\)/,
    )
  })
  it('and holds no second copy of the previous-turn tree query', () => {
    expect(src).not.toMatch(
      /with recursive me as \(\s*select origin_channel, split_part\(origin_ref/,
    )
  })
})
