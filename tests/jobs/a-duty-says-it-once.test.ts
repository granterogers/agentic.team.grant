/**
 * A duty may not tell him the same thing every hour (#355).
 *
 * Grant's Google refresh token was revoked on 15 September. For four days
 * `google.read_mail` and `google.read_calendar` each failed and each told him
 * so EVERY HOUR: 194 deliveries, and exactly ONE distinct body across all of
 * them. `office.notion_sync` has the same shape and hides it better -- 137
 * sends, 128 distinct bodies, because a model rewords the identical fact every
 * two hours, so it reads as news and no text-based witness can see it.
 *
 * Nothing could catch it. `check:chatter`'s ceiling is a hundred a day per kind
 * and this peaked around 36. `app.recurring_failures` and `app.notice`'s
 * failure_repeats branch both read FAILED jobs -- and these jobs COMPLETED
 * SUCCESSFULLY while reporting a failure.
 *
 * The worker asks `app.say_once` before writing `jobs.announce`. This test
 * asserts the WIRED CALL rather than the name, because CLAUDE.md records three
 * vacuous controls in one session that stayed green when the expression was
 * replaced by null -- the import still named the function and the declaration
 * still matched.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const worker = readFileSync('src/jobs/worker.ts', 'utf8')

describe('a scheduled duty says it once', () => {
  it('asks app.say_once with the OUTPUT BODY before writing announce', () => {
    // The body is what makes the question answerable. Passing the job alone
    // would compare nothing, and would pass a check that only sought the name.
    expect(worker).toMatch(
      /app\.say_once\(\$\{lit\(job\.jobId\)\}::uuid,\s*\$\{lit\(output\.body\)\}/,
    )
    /*
      AND THE TOPIC (#360), which is what lets it see past a rewording.
      `office.slack_rotate` reported one failed rotation 46 times in 30
      different wordings, because the branch that reports it calls `sayAs` and
      0584 fingerprinted the words.
    */
    expect(worker).toMatch(/\$\{lit\(output\.body\)\}, \$\{lit\(output\.topic\)\}\) as say/)
    /*
      AND THE ARITY FOLLOWS THE QUESTION, not what is newest. A handler with no
      topic asks 0584's TWO-argument form, which every deployed worker already
      calls. Sending everything through the three-argument form would mean that
      on a database without 0589 every call throws, and the catch would turn
      0584's dedupe off altogether rather than leaving it alone -- a safe
      failure mode is not the same as no regression.
    */
    expect(worker).toMatch(/output\.topic === undefined\s*\n?\s*\? `select app\.say_once\(/)
  })

  it('only ever turns speech into silence, never the other way round', () => {
    /*
      The guard runs under `if (announce)`. A handler that decided it had
      nothing to say must not be made to speak by a dedupe rule -- that would
      be a different defect wearing this fix's clothes.
    */
    const seam = worker.slice(
      worker.indexOf('if (output.announce !== undefined)'),
      worker.indexOf('await moveTo(db, job.jobId, ' + "'output_created'"),
    )
    expect(seam).not.toHaveLength(0)
    expect(seam).toMatch(/let announce = output\.announce/)
    expect(seam).toMatch(/if \(announce\) \{/)
    // The write uses the narrowed value, not the handler's original verdict.
    expect(seam).toMatch(/set announce = \$\{announce \? 'true' : 'false'\}/)
    expect(seam).not.toMatch(/set announce = \$\{output\.announce \? 'true' : 'false'\}/)
  })

  it('treats a missing answer as speech, so a broken guard cannot mute him', () => {
    // `!== false` rather than `=== true`: if the row comes back empty or the
    // column is null, the office SPEAKS. A dedupe rule that fails closed would
    // silence a real failure report, which is the expensive direction.
    expect(worker).toMatch(/say !== false/)
  })
})
