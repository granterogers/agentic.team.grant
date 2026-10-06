import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { judgeShape, statementsOf } from '../../scripts/rollout/shape.ts'

/*
  The stabilisation tool may apply ONE of four pinned files, and only if it contains nothing but function create-or-replace,
  dropping a named function, and function grants. This is the property "no data and no structure change", so each forbidden
  class below must be refused, and the four real files and their rollbacks must be accepted (the control that proves the check
  reads something).
*/
const manifest = JSON.parse(
  readFileSync('scripts/rollout/stabilisation/manifest.json', 'utf8'),
) as {
  steps: Record<string, { migration: string; rollback: string; objects: { sig: string }[] }>
}
const names = (id: string): Set<string> =>
  new Set((manifest.steps[id]?.objects ?? []).map((o) => o.sig.replace(/\(.*$/, '')))

const GOOD = `begin;
create or replace function app.hq_pulse(p_office uuid) returns jsonb language plpgsql stable security definer
 set search_path to 'public', 'pg_catalog' as $function$ begin return '{}'::jsonb; end $function$;
commit;`

describe('the stabilisation steps contain only function changes', () => {
  it('accepts the four real migrations and their rollbacks', () => {
    for (const id of Object.keys(manifest.steps)) {
      const s = manifest.steps[id]
      expect(s, id).toBeDefined()
      if (s === undefined) continue
      for (const [what, file] of [
        ['migration', s.migration],
        ['rollback', s.rollback],
      ] as const) {
        const sql = readFileSync(file, 'utf8')
        expect(statementsOf(sql).length, `${id} ${what} was read as empty`).toBeGreaterThan(1)
        expect(judgeShape(sql, what, names(id)), `${id} ${what}`).toEqual([])
      }
    }
  })

  it('accepts a plain function replacement (the control for the refusals below)', () => {
    expect(judgeShape(GOOD, 'x', new Set(['app.hq_pulse']))).toEqual([])
  })

  const FORBIDDEN: [string, string][] = [
    ['an insert', "insert into public.jobs (job_id) values ('x');"],
    ['an update', "update public.jobs set state = 'failed';"],
    ['a delete', 'delete from public.jobs;'],
    ['a truncate', 'truncate public.jobs;'],
    ['a table', 'create table public.t (a int);'],
    ['an alter table', 'alter table public.jobs add column z int;'],
    ['a drop table', 'drop table public.jobs;'],
    ['an index', 'create index i on public.jobs (state);'],
    [
      'a trigger',
      'create trigger t before insert on public.jobs for each row execute function f();',
    ],
    ['a policy', 'create policy p on public.jobs using (true);'],
    ['a table grant', 'grant select on public.jobs to anon;'],
    ['an extension', 'create extension pg_trgm;'],
    ['a role change', 'alter role anon with password x;'],
    [
      'a function granted to everybody',
      'grant execute on function public.cannot_think(uuid) to anon;',
    ],
    [
      'a function left executable by public',
      'grant execute on function app.hq_pulse(uuid) to public;',
    ],
  ]
  for (const [what, sql] of FORBIDDEN) {
    it(`refuses ${what}`, () => {
      const problems = judgeShape(
        `begin; ${GOOD.replace(/begin;|commit;/g, '')} ${sql} commit;`,
        'x',
        new Set(['app.hq_pulse']),
      )
      expect(problems.length, `${what} was let through`).toBeGreaterThan(0)
      expect(problems.join(' ')).toContain('not allowed')
    })
  }

  it('refuses a function the manifest does not name, even in an allowed shape', () => {
    const other = GOOD.replace('app.hq_pulse', 'app.office_health')
    const problems = judgeShape(other, 'x', new Set(['app.hq_pulse']))
    expect(problems.join(' ')).toContain('does not name')
  })

  it('refuses a dollar-quoted body that smuggles a second statement past the splitter', () => {
    // The body is removed before splitting; a statement AFTER the closing tag is still seen.
    const sneaky = `${GOOD}\ndelete from public.jobs;`
    expect(judgeShape(sneaky, 'x', new Set(['app.hq_pulse'])).join(' ')).toContain('not allowed')
  })

  it('refuses an empty file (a check that reads nothing proves nothing)', () => {
    expect(judgeShape('-- nothing here', 'x', new Set()).join(' ')).toContain('no statements')
  })
})
