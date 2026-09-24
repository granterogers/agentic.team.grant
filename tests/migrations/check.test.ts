import { describe, expect, it } from 'vitest'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { checkMigrations, splitStatements, stripComments } from '../../src/migrations/check.ts'

/** Deterministic stand-in for a real content hash. */
const hash = (content: string): string => `h:${content.length}:${content.trim().slice(0, 8)}`

const file = (name: string, sql = 'create table t (id int);'): MigrationFile => ({ name, sql })

const rules = (files: readonly MigrationFile[], recorded = {}): string[] =>
  checkMigrations(files, recorded, hash).map((f) => f.rule)

describe('naming', () => {
  it('accepts a well-formed migration', () => {
    expect(checkMigrations([file('0001_create_events.sql')], {}, hash)).toEqual([])
  })

  it.each([
    ['1_create_events.sql', 'sequence not zero-padded to four digits'],
    ['0001-create-events.sql', 'hyphens instead of underscores'],
    ['0001_CreateEvents.sql', 'not lower snake case'],
    ['0001_create_events.SQL', 'uppercase extension'],
    ['0001_create__events.sql', 'double underscore'],
    ['0001_.sql', 'no name after the sequence'],
    ['create_events.sql', 'no sequence at all'],
  ])('rejects %s (%s)', (name) => {
    expect(rules([file(name)])).toContain('name/format')
  })

  it('does not also report sequence problems for an unparseable name', () => {
    // A malformed name has no trustworthy sequence, so reporting a gap or a
    // bad start on top of the naming error would be noise pointing nowhere.
    expect(rules([file('nonsense.sql')])).toEqual(['name/format'])
  })
})

describe('content', () => {
  it('rejects an empty migration', () => {
    expect(rules([file('0001_empty.sql', '   \n\t ')])).toContain('content/empty')
  })
})

describe('sequence', () => {
  it('requires the first migration to be 0001', () => {
    expect(rules([file('0002_second.sql')])).toContain('sequence/start')
  })

  it('accepts a contiguous run', () => {
    const files = [file('0001_a.sql'), file('0002_b.sql'), file('0003_c.sql')]
    expect(checkMigrations(files, {}, hash)).toEqual([])
  })

  /*
    A gap is only a gap if something was LOST. The rule exists to catch a
    deleted migration, and it could not tell that from a branch that is simply
    behind -- numbers jumping from 0539 to 0577 because the ones between were
    written on another branch and are already applied to production. Reporting
    that as a failure leaves two options, renumbering into a collision or
    ignoring the check, and both are worse than the gap.
  */
  it('reports a gap over a number that was applied and whose file is gone', () => {
    const files = [file('0001_a.sql'), file('0003_c.sql')]
    const recorded = { '0002_b.sql': hash('-- 0002_b.sql'), '0001_a.sql': hash('-- 0001_a.sql') }
    expect(rules(files, recorded)).toContain('sequence/gap')
  })

  it('says nothing about a number this branch has simply never had', () => {
    const files = [file('0001_a.sql'), file('0003_c.sql')]
    expect(rules(files)).not.toContain('sequence/gap')
  })

  it('reports a duplicate sequence number', () => {
    const files = [file('0001_a.sql'), file('0001_b.sql')]
    expect(rules(files)).toContain('sequence/duplicate')
  })

  /*
    A collision that has ALREADY HAPPENED is history, not a mistake waiting
    to be made.

    Three sessions write to one database and `npm run migrate:next` exists
    to stop two of them taking the same number. On 21 September it happened
    anyway - Shadow Grant applied 0543 at 21:53 and Production Reliability
    applied a different 0543 at 22:04. Both rows are real, because
    `app.schema_migrations` is keyed on NAME.

    Renaming one to clear the check was tried and reverted: it would make
    the repository claim a migration ran under a number it did not, which
    is rewriting history to make a check green. So the check learned the
    distinction it was already holding the evidence for.

    The second case below is the one that matters. Without it this change
    is a hole: every duplicate would pass the moment one of the pair
    happened to be applied.
  */
  const applied = (...names: string[]): Record<string, string> =>
    Object.fromEntries(names.map((n) => [n, hash(file(n).sql)]))

  it('does NOT fail a duplicate where both files are already applied', () => {
    const files = [file('0001_a.sql'), file('0001_b.sql')]
    const r = rules(files, applied('0001_a.sql', '0001_b.sql'))
    expect(r).not.toContain('sequence/duplicate')
    expect(r).toContain('sequence/collided')
  })

  it('still FAILS a duplicate where one file is not yet applied', () => {
    const files = [file('0001_a.sql'), file('0001_b.sql')]
    const r = rules(files, applied('0001_a.sql'))
    expect(r).toContain('sequence/duplicate')
    expect(r).not.toContain('sequence/collided')
  })

  it('and fails one where NEITHER is applied', () => {
    expect(rules([file('0001_a.sql'), file('0001_b.sql')], {})).toContain('sequence/duplicate')
  })

  it('reports the recorded collision as a note, so nothing hides it', () => {
    const files = [file('0001_a.sql'), file('0001_b.sql')]
    const found = checkMigrations(files, applied('0001_a.sql', '0001_b.sql'), hash)
    expect(found.map((f) => f.severity)).toEqual(['note'])
    expect(found[0]?.message).toContain('0001_a.sql')
    expect(found[0]?.message).toContain('0001_b.sql')
  })

  it('is order-independent', () => {
    const ascending = [file('0001_a.sql'), file('0002_b.sql')]
    const descending = [file('0002_b.sql'), file('0001_a.sql')]
    expect(checkMigrations(descending, {}, hash)).toEqual(checkMigrations(ascending, {}, hash))
  })
})

describe('forbidden statements', () => {
  it('rejects re-granting UPDATE on events', () => {
    const sql = 'grant update on public.events to authenticated;'
    expect(rules([file('0001_x.sql', sql)])).toContain('ledger/no-regrant-write')
  })

  it('rejects re-granting DELETE on events across newlines', () => {
    const sql = 'GRANT\n  DELETE\nON TABLE public.events\nTO authenticated;'
    expect(rules([file('0001_x.sql', sql)])).toContain('ledger/no-regrant-write')
  })

  it('reports each rule at most once per file', () => {
    // Ten offending statements are one mistake to fix, not ten findings.
    const sql = [
      'grant update on public.events to authenticated;',
      'grant delete on public.events to anon;',
      'grant truncate on public.events to authenticated;',
    ].join('\n')
    const found = rules([file('0001_x.sql', sql)])
    expect(found.filter((r) => r === 'ledger/no-regrant-write')).toHaveLength(1)
  })

  it('rejects dropping the ledger', () => {
    expect(rules([file('0001_x.sql', 'drop table public.events;')])).toContain('ledger/no-drop')
  })

  it('rejects truncating the ledger', () => {
    // TRUNCATE is the subtle one: it destroys history while sidestepping the
    // DELETE revoke completely, so revoking DELETE alone is not enough.
    expect(rules([file('0001_x.sql', 'truncate table events;')])).toContain('ledger/no-truncate')
  })

  it('rejects disabling row level security', () => {
    const sql = 'alter table public.jobs disable row level security;'
    expect(rules([file('0001_x.sql', sql)])).toContain('rls/no-disable')
  })

  it('rejects granting a superuser role to another role', () => {
    expect(rules([file('0001_x.sql', 'grant postgres to app_user;')])).toContain(
      'security/no-superuser-grant',
    )
  })

  it('allows the REVOKE the specification actually requires', () => {
    const sql = 'revoke update, delete on public.events from authenticated, anon;'
    expect(checkMigrations([file('0001_x.sql', sql)], {}, hash)).toEqual([])
  })

  it('allows granting INSERT and SELECT on events', () => {
    // Append-only means writes append. INSERT and SELECT must stay grantable,
    // or the rule would forbid a working ledger.
    const sql = 'grant insert, select on public.events to authenticated;'
    expect(checkMigrations([file('0001_x.sql', sql)], {}, hash)).toEqual([])
  })

  it('does not trip on a comment that merely mentions a forbidden statement', () => {
    const sql = [
      '-- We deliberately never GRANT UPDATE ON events to any application role.',
      '/* Nor DROP TABLE events, for that matter. */',
      'create table public.events (event_id uuid primary key);',
    ].join('\n')
    expect(checkMigrations([file('0001_x.sql', sql)], {}, hash)).toEqual([])
  })
})

describe('statement boundaries — regression, 2026-09-03', () => {
  // The first implementation matched patterns against the whole file, so the
  // real 0003 migration failed its own check twice. Both cases below are
  // correct SQL that the specification actually requires.

  it('allows GRANT SELECT, INSERT followed by the required REVOKE', () => {
    // These two statements together read as "grant ... update ... on ... events"
    // when matched across the file. They are exactly what §6 demands.
    const sql = [
      'grant select, insert on public.events to ai_team_app;',
      'revoke update, delete, truncate on public.events from ai_team_app;',
    ].join('\n')
    expect(checkMigrations([file('0001_x.sql', sql)], {}, hash)).toEqual([])
  })

  it('distinguishes TRUNCATE the verb from TRUNCATE the privilege', () => {
    const revoking = 'revoke update, delete, truncate on public.events from anon;'
    expect(checkMigrations([file('0001_x.sql', revoking)], {}, hash)).toEqual([])

    const truncating = 'truncate table public.events;'
    expect(rules([file('0001_y.sql', truncating)])).toContain('ledger/no-truncate')
  })

  it('is not fooled by a semicolon inside a plpgsql function body', () => {
    // A naive split would shred this body into fragments, and one of those
    // fragments would start with a keyword it never really started with.
    const sql = [
      'create or replace function app.f() returns trigger language plpgsql as $$',
      'begin',
      "  raise exception 'events is append-only';",
      '  return null;',
      'end',
      '$$;',
      'grant select on public.events to ai_team_app;',
    ].join('\n')
    expect(checkMigrations([file('0001_x.sql', sql)], {}, hash)).toEqual([])
  })

  it('still catches a forbidden statement after a function body', () => {
    // The splitter must not swallow the rest of the file with an unbalanced tag.
    const sql = [
      'create function app.f() returns int language sql as $$ select 1; $$;',
      'drop table public.events;',
    ].join('\n')
    expect(rules([file('0001_x.sql', sql)])).toContain('ledger/no-drop')
  })

  it('does not treat a semicolon inside a string literal as a boundary', () => {
    const sql =
      "insert into public.system_config (key, value, description) values ('a.b', '1'::jsonb, 'drop table events; not really');"
    expect(checkMigrations([file('0001_x.sql', sql)], {}, hash)).toEqual([])
  })
})

describe('splitStatements', () => {
  it('splits on semicolons and normalises', () => {
    expect(splitStatements('SELECT 1;\n\n  select   2 ;')).toEqual(['select 1', 'select 2'])
  })

  it('keeps a dollar-quoted body intact', () => {
    const parts = splitStatements('create function f() as $$ a; b; c $$; select 1;')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain('a; b; c')
  })

  it('handles a tagged dollar quote', () => {
    const parts = splitStatements('do $body$ x; y $body$; select 1;')
    expect(parts).toHaveLength(2)
  })

  it('handles a doubled single quote inside a literal', () => {
    const parts = splitStatements("select 'it''s fine; really'; select 2;")
    expect(parts).toHaveLength(2)
  })

  it('drops empty statements from trailing semicolons', () => {
    expect(splitStatements('select 1;;;')).toEqual(['select 1'])
  })

  it('tolerates an unterminated dollar quote without hanging', () => {
    expect(() => splitStatements('do $$ never closed')).not.toThrow()
  })
})

describe('immutability of applied history', () => {
  const original = 'create table t (id int);'

  it('accepts an unchanged applied migration', () => {
    const recorded = { '0001_a.sql': hash(original) }
    expect(checkMigrations([file('0001_a.sql', original)], recorded, hash)).toEqual([])
  })

  it('rejects an edited applied migration', () => {
    const recorded = { '0001_a.sql': hash(original) }
    const edited = [file('0001_a.sql', 'create table t (id bigint);')]
    expect(rules(edited, recorded)).toContain('checksum/modified')
  })

  it('rejects deleting an applied migration', () => {
    const recorded = { '0001_a.sql': hash(original) }
    expect(rules([], recorded)).toContain('checksum/missing')
  })

  it('accepts a new migration alongside applied ones', () => {
    const recorded = { '0001_a.sql': hash(original) }
    const files = [file('0001_a.sql', original), file('0002_b.sql')]
    expect(checkMigrations(files, recorded, hash)).toEqual([])
  })
})

describe('stripComments', () => {
  it('removes line and block comments', () => {
    expect(stripComments('a -- b\nc /* d */ e').replace(/\s+/g, ' ').trim()).toBe('a c e')
  })
})

describe('an empty migrations directory', () => {
  it('is valid — Phase 1 starts from nothing', () => {
    expect(checkMigrations([], {}, hash)).toEqual([])
  })
})
