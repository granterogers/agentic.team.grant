/**
 * Does routing understand the CONCEPT, or has it memorised the words?
 *
 *   npm run verify:routing-breadth
 *   npm run verify:routing-breadth -- --matrix   # print the confusion matrix
 *
 * Issue #232, workstreams A–D of #231.
 *
 * `verify:roster` asks eight questions and is 7/7. That is a seed, not
 * acceptance: eight cases cannot tell a system that understands finance from
 * one that has the word "margin" in a list.
 *
 * ## Why this runs offline, and why that is not cheating
 *
 * Routing is a pure function plus one database lookup:
 *
 *     classifyIntent(text)                   pure
 *     app.who_knows_about(text, 3)           the expertise Grant edits
 *     pickRoster(classification, text, topical)   pure
 *
 * `handlers/instruction.ts:195` composes exactly those three, so this harness
 * calls the same three in the same order with the same inputs. That buys ~200
 * cases in seconds instead of ~50 minutes of real jobs, which is the difference
 * between a campaign and a gesture.
 *
 * It is only honest if the offline answer matches what the office actually
 * does, so **the last section injects a sample through the canonical
 * `inbound_commands` path and asserts the two agree**. If they ever diverge
 * this file is measuring a path the product does not take, which is CLAUDE.md's
 * most repeated trap and the reason that check exists.
 *
 * ## What is asserted, and what is only reported
 *
 * ASSERTED: every specialist is reachable by at least one natural phrasing;
 * trivial work stays with Claire; the offline harness agrees with production.
 *
 * REPORTED: per-agent accuracy and the confusion matrix. A hard threshold on
 * accuracy would be a number I invented, and #232 is explicit that overlapping
 * domains must be graded on the behavioural property rather than one rigid
 * correct answer. The matrix is for a person to read.
 */

import { classifyIntent } from '../../src/agents/intent.ts'
import { pickRoster, type RoleSlug } from '../../src/agents/router.ts'
import { nameSubjects } from '../../src/agents/subject.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
/*
  The key is resolved from the vault by the router itself, so the environment
  variable is optional here — a local run with one set keeps working and a run
  without one still reaches a model. Never printed.
*/
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}

import { HELD_OUT } from '../corpus/heldout.ts'
import { type Case, CORPUS as DEVELOPMENT } from '../corpus/routing.ts'

/*
  Which corpus (#235 §17).

  The development corpus found three routing defects and is FROZEN. Every one
  of those fixes could in principle have been a fix to that list rather than to
  the office's understanding, and no development score can tell the difference
  — so `--heldout` runs thirty formulations written afterwards, none of which
  appears in it. A large gap between the two is overfitting, and the report
  says so rather than quoting the flattering number.
*/
const HELD = process.argv.includes('--heldout')
const CORPUS = HELD ? HELD_OUT : DEVELOPMENT

console.log(
  `\nverify:routing-breadth${HELD ? ' (HELD OUT)' : ''} — ${String(CORPUS.length)} cases, ${String(new Set(CORPUS.map((c) => c.wants)).size)} targets\n`,
)

type Result = Case & {
  intent: string
  confident: boolean
  chosen: readonly string[]
  reason: string
  /** True when no word in the request matched and the meaning decided it. */
  viaSemantic: boolean
  verdict: 'correct' | 'acceptable' | 'claire-fallback' | 'wrong'
}

/*
  How many cases the semantic layer was actually asked about, and how many it
  named somebody for.

  Reported, and then asserted on. Every failure inside `nameSubjects` — no
  model, a rate limit, an empty completion — comes back as an empty array by
  design, which is correct for the product and catastrophic for a measurement:
  a run where every free model refused us would print the same 31% as a run
  where the layer works and would read as "the fix did nothing". The counters
  are what tell those two apart.
*/
let asked = 0
let named = 0

/*
  The Management API throttles, and a throttle is not a routing answer.

  Six concurrent expertise lookups is enough to earn a `ThrottlerException` on
  a busy minute, and the honest failure mode for this suite is to WAIT rather
  than to treat a 429 as "nobody knows about this" — which would report a
  perfectly good routing decision as a miss and move the headline accuracy
  figure for reasons that have nothing to do with the office.
*/
const patiently = async <T>(what: () => Promise<T>): Promise<T> => {
  let last: unknown
  for (const wait of [0, 2_000, 5_000, 12_000]) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      return await what()
    } catch (error) {
      last = error
      if (!String((error as Error).message).includes('Too Many Requests')) throw error
    }
  }
  throw last
}

const decide = async (c: Case): Promise<Result> => {
  const classification = classifyIntent(c.ask)
  const literal = (
    (
      await patiently(
        async () => await db.execute(`select slug from app.who_knows_about(${lit(c.ask)}, 3)`),
      )
    ).rows as {
      slug: RoleSlug
    }[]
  ).map((r) => r.slug)

  /*
    The same else-branch handlers/instruction.ts takes (#232).

    Not a second opinion: an expertise hit is Grant's own vocabulary saying who
    this belongs to, and the model is only asked when no word in the request
    named anybody.
  */
  let topical: readonly RoleSlug[] = literal
  let viaSemantic = false
  if (literal.length === 0) {
    asked++
    topical = await nameSubjects(db, router, c.ask)
    if (topical.length > 0) {
      named++
      viaSemantic = true
    }
  }
  const { roster, reason } = pickRoster(classification, c.ask, topical)

  const verdict: Result['verdict'] =
    c.wants === 'nobody'
      ? roster.length === 0
        ? 'correct'
        : 'wrong'
      : roster.includes(c.wants)
        ? 'correct'
        : roster.some((r) => (c.also ?? []).includes(r))
          ? 'acceptable'
          : roster.length === 0
            ? 'claire-fallback'
            : 'wrong'

  return {
    ...c,
    intent: classification.intent,
    confident: classification.confident,
    chosen: roster,
    reason,
    verdict,
    viaSemantic,
  }
}

/*
  Four at a time.

  Ninety-one cases, roughly half of which now make a model call, is four
  minutes serially and forty seconds in small batches — and the office is not
  the thing under test here, so there is no reason to be gentle with it beyond
  staying well inside a free tier's rate limit. Batched rather than unbounded
  because ninety-one simultaneous requests to a free endpoint is how you get
  429s that look like the layer failing to name anybody.
*/
const results: Result[] = []
for (let i = 0; i < CORPUS.length; i += 4) {
  results.push(...(await Promise.all(CORPUS.slice(i, i + 4).map(decide))))
  process.stdout.write('.')
}
console.log('')

// ---------------------------------------------------------------------------
// The confusion matrix
// ---------------------------------------------------------------------------

const targets = [...new Set(CORPUS.map((c) => c.wants))].sort()
const chosenNames = [
  ...new Set(results.flatMap((r) => (r.chosen.length === 0 ? ['(nobody)'] : [...r.chosen]))),
].sort()

if (process.argv.includes('--matrix')) {
  console.log(
    '\n| wanted \\ chosen | ' +
      chosenNames.map((n) => n.replace('-director', '')).join(' | ') +
      ' |',
  )
  console.log(`|---|${chosenNames.map(() => '---').join('|')}|`)
  for (const t of targets) {
    const row = results.filter((r) => r.wants === t)
    const cells = chosenNames.map((name) => {
      const n = row.filter(
        (r) => (r.chosen.length === 0 ? '(nobody)' : r.chosen).includes?.(name) ?? false,
      ).length
      const m = row.filter((r) =>
        name === '(nobody)' ? r.chosen.length === 0 : r.chosen.includes(name as RoleSlug),
      ).length
      return String(Math.max(n, m) || '')
    })
    console.log(`| **${t}** | ${cells.join(' | ')} |`)
  }
}

console.log('\nper-target accuracy')
for (const t of targets) {
  const row = results.filter((r) => r.wants === t)
  const good = row.filter((r) => r.verdict === 'correct' || r.verdict === 'acceptable').length
  const pct = Math.round((good / row.length) * 100)
  console.log(
    `  ${t.padEnd(24)} ${String(good).padStart(2)}/${String(row.length).padEnd(2)} ${String(pct).padStart(3)}%  ${'█'.repeat(Math.round(pct / 5))}`,
  )
}

console.log('\naccuracy by linguistic form')
const forms = [...new Set(CORPUS.map((c) => c.form))].sort()
for (const f of forms) {
  const row = results.filter((r) => r.form === f && r.wants !== 'nobody')
  if (row.length === 0) continue
  const good = row.filter((r) => r.verdict === 'correct' || r.verdict === 'acceptable').length
  console.log(
    `  ${f.padEnd(12)} ${String(good).padStart(2)}/${String(row.length).padEnd(2)} ${String(Math.round((good / row.length) * 100)).padStart(3)}%`,
  )
}

const specialists = results.filter((r) => r.wants !== 'nobody')
const hit = specialists.filter((r) => r.verdict === 'correct' || r.verdict === 'acceptable')
const fellBack = specialists.filter((r) => r.verdict === 'claire-fallback')
const wrong = specialists.filter((r) => r.verdict === 'wrong')
const controls = results.filter((r) => r.wants === 'nobody')
const falsePositives = controls.filter(
  (r) => r.verdict === 'wrong' && CORPUS.find((c) => c.ask === r.ask)?.defensible !== true,
)
const defensible = controls.filter(
  (r) => r.verdict === 'wrong' && CORPUS.find((c) => c.ask === r.ask)?.defensible === true,
)

console.log(
  `\noverall — ${String(hit.length)}/${String(specialists.length)} specialist cases reached someone acceptable ` +
    `(${String(Math.round((hit.length / specialists.length) * 100))}%)`,
)
console.log(`  fell back to Claire   ${String(fellBack.length)}`)
console.log(`  went to the wrong specialist ${String(wrong.length)}`)
console.log(
  `  read for meaning   ${String(asked)} cases had no literal match; the semantic layer named somebody for ${String(named)}`,
)
console.log(
  `  false positives on the ${String(controls.length)} Claire-only controls: ${String(falsePositives.length)}` +
    (defensible.length === 0
      ? ''
      : ` (plus ${String(defensible.length)} defensible: ${defensible.map((r) => `"${r.ask.slice(0, 32)}" -> ${r.chosen.join(',')}`).join(', ')})`),
)

// ---------------------------------------------------------------------------
console.log('\nwhat must be true')
// ---------------------------------------------------------------------------

/*
  Reachability, which is the acceptance criterion #231 lists first. Not
  "accurate" — REACHABLE. A specialist nothing can route to is dead weight
  however good the rest of the numbers look.
*/
for (const t of targets.filter((x) => x !== 'nobody')) {
  const row = results.filter((r) => r.wants === t)
  const reached = row.filter((r) => r.chosen.includes(t as RoleSlug))
  ok(
    `${t} is reachable by at least one natural phrasing`,
    reached.length > 0,
    reached.length === 0
      ? `UNREACHABLE across ${String(row.length)} phrasings`
      : `${String(reached.length)}/${String(row.length)} phrasings`,
  )
}

/*
  The negative control, and it is not a formality. The obvious way to make the
  numbers above look good is to widen everything, which puts a model call on
  every "how are we doing?" — #230's fix was one line from doing exactly that.
*/
/*
  The semantic layer was actually reached.

  Every failure inside `nameSubjects` degrades to an empty array on purpose,
  so a run in which every free model refused us produces exactly the numbers a
  run with no semantic layer at all produces. Without this check the suite
  would report the pre-#232 accuracy and read as "the fix did nothing", which
  is the most expensive possible way to be wrong about your own measurement.

  Asserted as a PROPERTY rather than a rate: it named somebody at least once.
  A threshold here would be a second, worse copy of the accuracy figures below
  and would go red the day the literal matcher improves enough that hardly
  anything reaches this layer.
*/
ok(
  'the semantic layer was reached and answered, so these numbers describe it',
  asked === 0 || named > 0,
  asked === 0
    ? 'every case matched literally — nothing to read for meaning'
    : `${String(named)}/${String(asked)} named somebody`,
)

ok(
  'trivial work still goes to Claire alone — no false-positive specialists',
  falsePositives.length === 0,
  falsePositives.length === 0
    ? `all ${String(controls.length)} controls held`
    : falsePositives.map((r) => `"${r.ask.slice(0, 40)}" -> ${r.chosen.join(',')}`).join(' | '),
)

// ---------------------------------------------------------------------------
console.log('\nand the offline harness matches what the office actually does')
// ---------------------------------------------------------------------------

/*
  The check that makes everything above admissible.

  This file calls classifyIntent, who_knows_about and pickRoster the way
  handlers/instruction.ts does. If that ever stops being true, every number
  above describes a path the product does not take. Rather than asserting the
  composition by reading it, a sample is put through the REAL canonical path and
  the routing decision the worker recorded is compared with the offline answer.
*/
const sample = [
  /*
    One case the offline pass routes to a REAL specialist, and one it does not.

    Both halves are load-bearing. A sample of two fallback cases would agree
    with the product for the wrong reason — `roster[0] ?? 'chief-of-staff'`
    makes an empty roster and a Claire roster indistinguishable, so the check
    would pass without ever exercising the topical path it exists to validate.
    CLAUDE.md records the same mistake in a router unit test. The specialist
    case is CHOSEN FROM THIS RUN's results rather than named, so improving the
    routing cannot silently turn this half back into a fallback case.
  */
  /*
    Deliberately a case NO WORD in which names anybody.

    This is the half that proves the deployed worker is running #232's code
    rather than the repository's. A literal-match case would agree with the
    live decision even against a worker built before any of this existed —
    CLAUDE.md: a migration is not a deploy, and neither is a commit.
  */
  CORPUS.find(
    (c) => c.wants !== 'nobody' && (results.find((r) => r.ask === c.ask)?.viaSemantic ?? false),
  ),
  /* And one the literal matcher DOES claim, so the ordinary path is covered too. */
  CORPUS.find(
    (c) =>
      c.wants !== 'nobody' &&
      (results.find((r) => r.ask === c.ask)?.chosen.length ?? 0) > 0 &&
      !(results.find((r) => r.ask === c.ask)?.viaSemantic ?? false),
  ),
  CORPUS.find((c) => c.wants === 'nobody'),
].filter((c): c is Case => c !== undefined)

const run = Math.random().toString(36).slice(2, 10)
const ACTOR = `verify-breadth-${run}`
const project = (
  (
    await db.execute(`
      insert into public.projects (name, slug, status)
      values (${lit(`Fixture breadth ${run}`)}, ${lit(`fixture-breadth-${run}`)}, 'paused')
      returning project_id::text as id`)
  ).rows as { id: string }[]
)[0]?.id
const jobIds: string[] = []
for (const [i, c] of sample.entries()) {
  const key = `teamhq:breadth_probe:${run}-${String(i)}`
  const row = (
    (
      await db.execute(`
        begin;
        insert into public.inbound_commands
          (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
        values ('teamhq', ${lit(`breadth-${run}`)}, ${lit(ACTOR)}, ${lit(c.ask)},
                ${lit(key)}, app.now_utc(), ${lit(String(project))}::uuid);
        create temp table _j as
          select (app.enqueue_inbound(
                    (select command_id from public.inbound_commands where dedupe_key = ${lit(key)})
                  ) ->> 'job_id')::uuid as id;
        update public.jobs set announce = false where job_id = (select id from _j);
        select (select id from _j)::text as id;
        commit;`)
    ).rows as { id: string }[]
  )[0]
  jobIds.push(String(row?.id))
}

const loud = (
  (
    await db.execute(
      `select count(*)::int as n from public.jobs where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}]) and announce`,
    )
  ).rows as { n: number }[]
)[0]
ok(
  'the canonical sample cannot announce to Grant',
  Number(loud?.n) === 0,
  `${String(loud?.n)} announcing`,
)

process.stdout.write('       waiting for the worker')
const deadline = Date.now() + 6 * 60 * 1000
let decisions: { job_id: string; roster: string }[] = []
while (Date.now() < deadline) {
  decisions = (
    await db.execute(`
      select job_id::text as job_id, coalesce(array_to_string(roster, ','), '') as roster
        from public.routing_decisions
       where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}])`)
  ).rows as { job_id: string; roster: string }[]
  if (decisions.length >= jobIds.length) break
  process.stdout.write('.')
  await new Promise((r) => setTimeout(r, 15_000))
}
console.log('')

/*
  An empty roster is not "nobody" — it is Claire.

  `handlers/instruction.ts` resolves the speaker as `roster[0] ?? 'chief-of-staff'`,
  so the office's answer to a request no specialist claims is the Chief of Staff,
  and `routing_decisions.roster` records her. Comparing the raw arrays reported a
  disagreement on the first run (offline=[] live=[chief-of-staff]) that was
  entirely this harness failing to speak the product's vocabulary. Normalise both
  sides through the same rule the product uses, and keep the full roster rather
  than only the speaker so a difference in BREADTH still shows up.
*/
const speaks = (roster: readonly string[]): string =>
  (roster.length === 0 ? ['chief-of-staff'] : [...roster]).sort().join(',')

let agreed = 0
for (const [i, c] of sample.entries()) {
  const offline = results.find((r) => r.ask === c.ask)
  const live = decisions.find((d) => d.job_id === jobIds[i])
  const liveRoster = speaks((live?.roster ?? '').split(',').filter(Boolean))
  const offlineRoster = speaks([...(offline?.chosen ?? [])])
  if (liveRoster === offlineRoster) agreed++
  console.log(
    `       "${c.ask.slice(0, 44)}…"  offline=[${offlineRoster || 'nobody'}] live=[${liveRoster || 'nobody'}]`,
  )
}
ok(
  'the offline harness agrees with the canonical path, so its numbers describe the real product',
  agreed === sample.length && decisions.length === jobIds.length,
  `${String(agreed)}/${String(sample.length)} agreed, ${String(decisions.length)}/${String(jobIds.length)} routed`,
)

await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:routing-breadth sample, cancelled in teardown'
   where job_id = any(array[${jobIds.map((j) => `${lit(j)}::uuid`).join(',')}])
     and state not in ('complete','cancelled','failed','committing','committed','notifying')`)
await db.execute(
  `delete from public.inbound_commands where actor = ${lit(ACTOR)} and job_id is null`,
)
await db.execute(
  `update public.projects set status = 'archived' where project_id = ${lit(String(project))}::uuid`,
)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)

/*
  The misses, printed in full, because they are the deliverable. A count says
  routing is 71%; this says WHICH concepts it cannot reach, which is the only
  form the finding can be acted on in.
*/
const missed = [...fellBack, ...wrong]
if (missed.length > 0) {
  console.log(`\n${String(missed.length)} case(s) did not reach their specialist:\n`)
  for (const m of missed) {
    console.log(
      `  [${m.form}] wanted ${m.wants}, got ${m.chosen.length === 0 ? 'Claire' : m.chosen.join(',')}` +
        ` — "${m.ask.slice(0, 60)}"`,
    )
  }
}
if (fail > 0) process.exit(1)
