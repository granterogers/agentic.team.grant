/**
 * Every capability has a mouth (#72).
 *
 * Five times in one session a capability shipped as a table plus a function
 * with nothing that calls it — `app.notice()`, `tool_requests`,
 * `app.connector_purpose`, `app.studio_requests`, `app.lessons_for` — and each
 * one passed its own verification suite, because the suite was the only
 * caller. The clearest was the last: a memory built so agents could learn from
 * Grant's corrections, never read by anything that talks to Grant.
 *
 * Why it keeps happening, in #72's own words: a migration is satisfying and
 * self-contained, a verify suite written beside it exercises exactly the
 * surface the migration created, the suite is green, the Issue looks done, and
 * **the gap is precisely in the join** — which nothing is pointed at.
 *
 * This is option 1 from that Issue. It lists every `app.*` and `public.*`
 * function the database holds and asks who can reach it.
 *
 * ## What counts as a caller, and why the list is not just `src/`
 *
 * A function is REACHABLE if any of these is true:
 *
 *   - application code names it — `src/`, `web/`, `supabase/functions/`;
 *   - another database function's body names it, because a helper called by
 *     one reachable function is reached;
 *   - a trigger, a default, a view or a constraint names it;
 *   - it is a `public.*` wrapper over an `app.*` function somebody reaches,
 *     since PostgREST only exposes `public` and the wrapper IS the mouth.
 *
 * A function reachable ONLY from `scripts/verify/` is the defect. That is the
 * shape all five had.
 *
 * ## Why it reports rather than lists exceptions
 *
 * An allowlist of "deliberately uncalled" functions is a second place to
 * forget something, and it grows. Instead the check derives reachability and
 * fails on what is left, so the way to satisfy it is to CALL the thing or to
 * remove it — which are the only two honest answers.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)

type Fn = { schema: string; name: string; body: string }

const fns = (
  await db.execute(`
    select n.nspname as schema, p.proname as name,
           coalesce(p.prosrc, '') as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public')
       and p.prokind = 'f'
     order by n.nspname, p.proname
  `)
).rows as Fn[]

/*
  Everything the database itself names: other function bodies, trigger
  definitions, view definitions and column defaults. One query rather than
  four, because the question is the same — does any stored SQL mention it.
*/
const sqlMentions = String(
  (
    await db.execute(`
      select string_agg(x.t, '
') as all_sql from (
        select coalesce(prosrc, '') as t from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('app', 'public')
        union all
        select pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
        union all
        select pg_get_viewdef(oid, true) from pg_class
         where relkind in ('v', 'm') and relnamespace = 'public'::regnamespace
        union all
        select pg_get_expr(adbin, adrelid) from pg_attrdef
        union all
        select pg_get_constraintdef(oid) from pg_constraint where contype = 'c'
        union all
        -- pg_cron. The worker heartbeat is called by nothing in the
        -- repository and by a schedule every minute, which is the most
        -- reachable a function gets. Omitting this source made the heartbeat
        -- itself look like the defect this check exists to find.
        -- No backticks in this comment: it lives inside a template literal.
        select command from cron.job
      ) x
    `)
  ).rows[0]?.all_sql ?? '',
)

/*
  Application code, read once. `git grep -l` per function would be 619
  subprocesses; one concatenation of the three trees is a few megabytes and is
  searched in memory.

  `scripts/` is deliberately EXCLUDED — a caller in scripts/verify is exactly
  the thing this check exists to disbelieve, and a caller in scripts/ generally
  is a capability Grant does not have (CLAUDE.md's standing goal).
*/
const appCode = execSync(
  "find src web supabase/functions -type f \\( -name '*.ts' -o -name '*.js' -o -name '*.mjs' \\) -print0 | xargs -0 cat",
  { maxBuffer: 256 * 1024 * 1024 },
).toString()

const scriptCode = execSync("find scripts -type f -name '*.ts' -print0 | xargs -0 cat", {
  maxBuffer: 256 * 1024 * 1024,
}).toString()

const named = (haystack: string, name: string): boolean => haystack.includes(name)

/*
  A public wrapper is the mouth of the app function it wraps, so an app
  function named by a reachable public wrapper is reachable. Resolved by one
  pass over the wrappers rather than by recursion: wrappers are one line deep
  here by convention, and a general transitive closure would make an unreached
  helper chain look reached through itself.
*/
const publicBodies = new Map(fns.filter((f) => f.schema === 'public').map((f) => [f.name, f.body]))
const reachedPublic = new Set([...publicBodies.keys()].filter((n) => named(appCode, n)))

/*
  A public wrapper over a reachable app function is itself reachable, and this
  is the correction that stopped the check crying wolf.

  PostgREST only exposes `public`, so every `app.*` RPC gets a wrapper. Twelve
  of them are not named by the gateway at all — hq_search_documents,
  hq_job_trace, hq_approve_tool and the rest — and the first run reported all
  twelve as capabilities nothing can reach.

  They are not. A wrapper exists so an AGENT holding the bearer token can call
  the thing over PostgREST, which is #13's whole point: everything the UI can
  do, an agent should be able to do. No grep of this repository can see that
  caller, because it is not in this repository.

  So the test for a wrapper is whether the CAPABILITY has a mouth, not whether
  the wrapper does: if the app function it wraps is reached by application
  code, the wrapper is an additional door onto something already in use. A
  wrapper over an app function nothing reaches is still reported, and that is
  the pair #72 was actually about.
*/
const reachedApp = new Set(
  fns.filter((f) => f.schema === 'app' && named(appCode, f.name)).map((f) => f.name),
)

type Verdict = { fn: string; why: string }
const mouthless: Verdict[] = []
const onlyTests: Verdict[] = []

for (const f of fns) {
  const full = `${f.schema}.${f.name}`
  if (named(appCode, f.name)) continue
  // Named by a public wrapper application code reaches.
  if (
    f.schema === 'app' &&
    [...reachedPublic].some((w) => (publicBodies.get(w) ?? '').includes(f.name))
  ) {
    continue
  }
  // A wrapper over an app function application code already reaches.
  if (f.schema === 'public' && [...reachedApp].some((a) => f.body.includes(a))) continue
  // Named by any stored SQL other than its own body.
  const elsewhere = sqlMentions.split(f.body).join('')
  if (named(elsewhere, f.name)) continue

  if (named(scriptCode, f.name)) {
    onlyTests.push({ fn: full, why: 'only scripts/ names it — a suite is not a caller' })
  } else {
    mouthless.push({ fn: full, why: 'nothing in the repository names it at all' })
  }
}

const found = [...mouthless, ...onlyTests].map((v) => v.fn).sort()

console.log(
  `check:callers — ${String(fns.length)} function(s) in app and public; ` +
    `${String(mouthless.length)} unreachable, ${String(onlyTests.length)} reached only by scripts/`,
)

/*
  A found-nothing check needs a control that must come back positive, because
  a zero and a broken parse are produced by the same code — `npm run levels`
  reported 0 once while a missing import sent every lookup into a catch.
  If the concatenation of the three trees came back tiny, the grep is reading
  nothing and EVERY function would look unreachable, so say that instead.
*/
if (appCode.length < 200_000) {
  console.error(
    `check:callers FAILED — read only ${String(appCode.length)} bytes of application code. ` +
      'The find is matching nothing; this check is not looking at the repository.',
  )
  process.exit(1)
}

/*
  A baseline that may only SHRINK.

  Forty on the first run, which is too many to be a gate today and exactly the
  number that makes somebody switch a gate off. So the check fails on a
  function that is NOT in the baseline - a new capability with no mouth, which
  is what #72 is about - and it also fails when a baseline entry has BECOME
  reachable, which forces the file down as things get wired.

  That second half is the difference between a baseline and an allowlist. An
  allowlist is a place to forget things; a baseline that goes red when it is
  stale cannot sit at forty for ever without somebody noticing, and every
  entry removed is a capability that grew a mouth.
*/
const BASELINE = 'docs/testing/callers-baseline.json'
const baseline: string[] = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as { unreached: string[] }).unreached
  : []

const fresh = found.filter((f) => !baseline.includes(f))
const fixed = baseline.filter((b) => !found.includes(b))

for (const v of [...mouthless, ...onlyTests]) {
  console.log(`  ${fresh.includes(v.fn) ? 'NEW ' : '    '}${v.fn} — ${v.why}`)
}

if (fresh.length > 0) {
  console.error(
    `\ncheck:callers FAILED — ${String(fresh.length)} capability nobody can reach (#72):`,
  )
  for (const f of fresh) console.error(`  ${f}`)
  console.error(
    '\nName the line of handler or UI code that reads it, or remove it. A verify ' +
      'suite is not a caller — it is the thing that made all five of the original ' +
      'examples look finished.',
  )
  process.exit(1)
}

if (fixed.length > 0) {
  console.error(
    `\ncheck:callers FAILED — ${String(fixed.length)} baseline entr(y/ies) are now reachable. ` +
      `Remove them from ${BASELINE} so the number keeps going down:`,
  )
  for (const f of fixed) console.error(`  ${f}`)
  process.exit(1)
}

console.log(
  found.length === 0
    ? 'every function is reachable from something that is not a test.'
    : `${String(found.length)} known, all in the baseline — and it may only shrink.`,
)
