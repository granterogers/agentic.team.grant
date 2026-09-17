/**
 * The schema's own dangling references.
 *
 *   npm run verify:schema
 *
 * ## The failure this exists for
 *
 * Renaming a table rewrites every view and every constraint that depends on it,
 * because those hold a parsed reference. A function body does not: it is stored
 * as text and resolved when it is called. So 0051's rename left
 * `app.project_attention()` naming a table that no longer existed, the
 * migration applied cleanly, `verify:sync` went green, and the symptom was a
 * **502 from Team HQ** — three layers away, in a dashboard, hours later.
 *
 * A rename is not the only way to get here. Dropping a table, moving one
 * between schemas, or renaming a column all leave function bodies untouched and
 * unchecked. This is the check that turns that into a red line at the moment it
 * happens rather than a support question later.
 *
 * It is deliberately structural rather than behavioural: it does not call
 * anything, so it costs nothing and cannot have side effects.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: { what: string; outcome: string; passed: boolean }[] = []

// Every `schema.name` a function body mentions, against every relation that
// exists. A name that appears in no catalogue is either a table that was
// renamed out from under the function or one that never existed.
const dangling = (
  await db.execute(`
    with raw as (
      select n.nspname || '.' || p.proname as fn, pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('app', 'public')
    ),
    bodies as (
      -- A COMMENT IS NOT A CALL, and this check reported one as a dangling
      -- reference the day 0452 dropped app.what_i_can_do: hq_governance
      -- explains in prose why it no longer calls it, and the regex read the
      -- explanation as the call. The explanation is the thing that stops
      -- somebody putting it back, so the check has to read past it rather
      -- than the comment having to go.
      --
      -- Innermost-first for the block form, which is all a regex can do about
      -- comments Postgres NESTS; a stray closing marker left behind carries no
      -- qualified name, so it cannot hide a real reference. Only a strict
      -- subset of the text is removed, which is the direction that matters:
      -- this can never invent a reference, only decline to read one inside a
      -- comment.
      select fn,
             regexp_replace(
               regexp_replace(def, '/\\*.*?\\*/', ' ', 'gs'),
               '--[^' || chr(10) || ']*', ' ', 'g') as def
        from raw
    ),
    referenced as (
      select b.fn,
             lower((regexp_matches(b.def, '\\m(app|public)\\.([a-z_][a-z0-9_]*)', 'gi'))[1]
                   || '.' ||
                   (regexp_matches(b.def, '\\m(app|public)\\.([a-z_][a-z0-9_]*)', 'gi'))[2]) as ref
      from bodies b
    ),
    known as (
      select lower(n.nspname || '.' || c.relname) as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       union
      select lower(n.nspname || '.' || p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       union
      select lower(n.nspname || '.' || t.typname)
        from pg_type t join pg_namespace n on n.oid = t.typnamespace
       union
      /*
        Runtime settings, which are not relations and never were.

        app.undoing is a GUC. current_setting of it is how hq_undo, undo_none
        and undo_offer stop an undo from recording an undo of itself. It is
        the word app, a dot and a name, inside a STRING LITERAL -- so a regex
        over the function body sees it and the catalogue does not, and three
        correct functions were reported as naming a table that does not exist.

        Taken from the settings the bodies themselves name rather than from a
        hand-written list, so a new one is covered the day it is written. This
        is the narrowest honest widening: a GUC really is a qualified name
        that legitimately has no catalogue entry.

        Two things this comment must not contain, both learned here. No
        backtick: it lives inside a JS template literal and a backtick ends the
        string, which is CLAUDE.md's first trap and check:templates does not
        cover scripts. And no slash-star sequence: Postgres NESTS block
        comments, so writing the glob for the web folder opened a nested
        comment that was never closed.
      */
      select distinct lower(m[1])
        from bodies b,
             lateral regexp_matches(
               b.def,
               '(?:current_setting|set_config)\\s*\\(\\s*''((?:app|public)\\.[a-z_][a-z0-9_]*)''',
               'gi') as m
    )
    select distinct r.fn, r.ref
      from referenced r
     where not exists (select 1 from known k where k.name = r.ref)
     order by r.fn, r.ref
  `)
).rows as { fn: string; ref: string }[]

checks.push({
  what: 'no function body names a table, function or type that does not exist',
  outcome:
    dangling.length === 0
      ? 'every qualified name in every app/public function resolves'
      : dangling.map((d) => `${d.fn} -> ${d.ref}`).join(', '),
  passed: dangling.length === 0,
})

// CONTROL. Without it this suite would pass just as happily against a query
// that returns no rows for any reason at all — an empty `referenced`, a broken
// regex, a `known` set that accidentally contains everything.
const control = (
  await db.execute(`
    with known as (
      select lower(n.nspname || '.' || c.relname) as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
    )
    select
      (select count(*)::int from known) as known_names,
      (select count(*)::int from known
        where name = 'public.a_relation_that_does_not_exist') as impossible
  `)
).rows[0] as { known_names: number; impossible: number }

/*
  CONTROL for the comment stripping above.

  Removing text is the one way this check can go quietly blind: a regex that
  matched too much would leave nothing to resolve and the suite would report
  that every qualified name resolves. So count what survives, and require it
  to be a corpus rather than a handful.
*/
const surviving = (
  await db.execute(`
    with raw as (
      select pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'public')
    )
    select count(*)::int as n
      from raw r,
           lateral regexp_matches(
             regexp_replace(
               regexp_replace(r.def, '/\\*.*?\\*/', ' ', 'gs'),
               '--[^' || chr(10) || ']*', ' ', 'g'),
             '\\m(app|public)\\.[a-z_][a-z0-9_]*', 'gi')
  `)
).rows[0] as { n: number }

checks.push({
  what: 'CONTROL: stripping comments leaves the references it is meant to read',
  outcome: `${String(surviving.n)} qualified name(s) survive the strip`,
  passed: surviving.n > 500,
})

checks.push({
  what: 'CONTROL: the catalogue query sees real relations and not a fabricated one',
  outcome: `${String(control.known_names)} known relation(s); the impossible one matched ${String(control.impossible)} time(s)`,
  passed: control.known_names > 50 && control.impossible === 0,
})

console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exit(1)
