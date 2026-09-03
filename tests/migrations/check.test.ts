import { describe, expect, it } from 'vitest'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { checkMigrations, stripComments } from '../../src/migrations/check.ts'

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

  it('reports a gap', () => {
    const files = [file('0001_a.sql'), file('0003_c.sql')]
    expect(rules(files)).toContain('sequence/gap')
  })

  it('reports a duplicate sequence number', () => {
    const files = [file('0001_a.sql'), file('0001_b.sql')]
    expect(rules(files)).toContain('sequence/duplicate')
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
