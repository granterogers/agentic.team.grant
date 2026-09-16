/**
 * Every model call the office makes says which job it was for (#268, #127).
 *
 * `public.model_record` keys the quality record on `(model, kind)`, and the
 * kind comes from `jobs.kind` through `inference_usage.job_id`. A caller that
 * does not pass `jobId` lands under `(unattributed)` and can never inform any
 * real kind's record — so a model that is good at answering and poor at
 * structuring cannot be told apart, which is the whole reason #127 keeps the
 * record per kind.
 *
 * ## Why a source check rather than a runtime one
 *
 * The failure is a call site that FORGOT, and a runtime check only sees the
 * call sites a test happens to drive. This reads every caller in `src/` and
 * fails on one that neither attributes nor says why not — which is the
 * property the issue asks for, and it fires the moment somebody adds the
 * eighth caller rather than months later when a record is mysteriously thin.
 *
 * A comment is accepted as an answer on purpose. `src/projects/brief.ts`
 * genuinely has no job — its only caller is a script a person runs — and
 * inventing one would put harness traffic into a measurement (0395). The rule
 * is not "always attribute", it is "attribute or say why".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
  })

describe('#268 — a model call names the job it was for', () => {
  const callers = walk('src')
    .filter((f) => !f.endsWith(join('providers', 'router.ts')))
    .map((f) => ({ file: f, text: readFileSync(f, 'utf8') }))
    .filter((f) => f.text.includes('.complete('))

  /*
    The list must not be empty, or every assertion below passes by finding
    nothing. A check whose happy path is "found nothing" is one this
    repository has shipped before.
  */
  it('finds the callers at all', () => {
    expect(callers.length).toBeGreaterThanOrEqual(6)
  })

  it('every caller either passes jobId or says why it cannot', () => {
    const silent = callers
      /*
        `jobId:` with the colon, not the bare word.

        The first version used `includes('jobId')` and a synthetic failure —
        renaming every `jobId` to `jobIdX` in one caller — did NOT turn it red,
        because `jobIdX` contains `jobId`. It would also have been satisfied by
        a file that merely mentions the word in a comment. The property is that
        the option is PASSED, and the colon is what says so.
      */
      .filter((f) => !/\bjobId:/.test(f.text))
      .filter((f) => !/No `jobId`, deliberately/.test(f.text))
      .map((f) => f.file)
    expect(silent).toEqual([])
  })

  /*
    And the one that says why still has to say it — otherwise removing the
    comment while leaving the call unattributed would pass the check above by
    making the file disappear from both lists.
  */
  it('the exemption is a stated one, not an absence', () => {
    const exempt = callers.filter((f) => /No `jobId`, deliberately/.test(f.text))
    for (const f of exempt) {
      expect(f.text).toMatch(/#268/)
      expect(f.text).toMatch(/unattributed/)
    }
  })
})
