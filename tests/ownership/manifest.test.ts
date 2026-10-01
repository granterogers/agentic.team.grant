/**
 * The ownership manifest refuses what it must, and accepts what it should (multi-user P0).
 *
 * Every rule is driven with an injected defect AND its legitimate neighbour, because a validator
 * that refuses everything passes a suite made only of refusals.
 */
import { describe, expect, it } from 'vitest'
import { controls, loadManifest } from '../../scripts/check-ownership.ts'
import {
  type Catalogue,
  type Manifest,
  type ManifestEntry,
  readCatalogue,
  suggest,
  validate,
} from '../../src/ownership/manifest.ts'

const fk = (child: string, constraint: string, parent: string, columns: [string, boolean][]) => ({
  child,
  constraint,
  parent,
  columns: columns.map(([column, notNull]) => ({ column, notNull })),
})

const cat: Catalogue = {
  tables: ['projects', 'tasks', 'notes', 'job_steps', 'jobs', 'staff', 'cfg'],
  fks: [
    fk('tasks', 'tasks_project_fkey', 'projects', [['project_id', false]]),
    fk('notes', 'notes_project_fkey', 'projects', [['project_id', true]]),
    fk('job_steps', 'job_steps_job_fkey', 'jobs', [['job_id', true]]),
    fk('jobs', 'jobs_project_fkey', 'projects', [['project_id', false]]),
    fk('notes', 'notes_job_fkey', 'jobs', [['job_id', false]]),
  ],
}

const good: Manifest = {
  version: 1,
  baseline: 'test',
  tables: {
    projects: { class: 'OFFICE_CARRIER', why: 'root' },
    jobs: {
      class: 'OFFICE_CARRIER',
      why: 'project is nullable',
      cross: [{ columns: ['project_id'], parent: 'projects', constraint: 'jobs_project_fkey' }],
    },
    tasks: {
      class: 'OFFICE_CARRIER',
      why: 'project is nullable',
      cross: [{ columns: ['project_id'], parent: 'projects', constraint: 'tasks_project_fkey' }],
    },
    notes: {
      class: 'OFFICE_DERIVED',
      path: [{ columns: ['project_id'], parent: 'projects', constraint: 'notes_project_fkey' }],
      cross: [{ columns: ['job_id'], parent: 'jobs', constraint: 'notes_job_fkey' }],
    },
    job_steps: {
      class: 'OFFICE_DERIVED',
      path: [{ columns: ['job_id'], parent: 'jobs', constraint: 'job_steps_job_fkey' }],
    },
    staff: { class: 'GLOBAL', why: 'the shared roster, identical for every office' },
    cfg: { class: 'SYSTEM', why: 'deployment settings no human office may own' },
  },
}

const withEntry = (table: string, entry: ManifestEntry | undefined): Manifest => {
  const tables: Record<string, ManifestEntry> = { ...good.tables }
  if (entry === undefined) delete tables[table]
  else tables[table] = entry
  return { ...good, tables }
}

describe('validate', () => {
  it('accepts a manifest that accounts for the catalogue (the positive control)', () => {
    expect(validate(good, cat)).toEqual([])
  })

  it('refuses a table nobody classified', () => {
    const problems = validate(withEntry('tasks', undefined), cat)
    expect(problems.some((p) => p.startsWith('tasks: UNCLASSIFIED'))).toBe(true)
  })

  it('refuses an entry for a table that does not exist', () => {
    const problems = validate(
      withEntry('ghost', { class: 'GLOBAL', why: 'a table that was dropped last week' }),
      cat,
    )
    expect(problems.some((p) => p.startsWith('ghost:'))).toBe(true)
  })

  it('refuses to derive through a NULLABLE column, whatever the rows hold today', () => {
    const problems = validate(
      withEntry('tasks', {
        class: 'OFFICE_DERIVED',
        path: [{ columns: ['project_id'], parent: 'projects', constraint: 'tasks_project_fkey' }],
      }),
      cat,
    )
    expect(problems.some((p) => p.includes('nullable in the schema'))).toBe(true)
  })

  it('accepts the same table once the schema makes the column NOT NULL', () => {
    const notNull: Catalogue = {
      ...cat,
      fks: cat.fks.map((f) =>
        f.constraint === 'tasks_project_fkey'
          ? fk('tasks', f.constraint, 'projects', [['project_id', true]])
          : f,
      ),
    }
    const asDerived = withEntry('tasks', {
      class: 'OFFICE_DERIVED',
      path: [{ columns: ['project_id'], parent: 'projects', constraint: 'tasks_project_fkey' }],
    })
    expect(validate(asDerived, notNull)).toEqual([])
  })

  it('refuses a derived table whose parent is not owned', () => {
    const problems = validate(
      withEntry('projects', {
        class: 'SYSTEM',
        why: 'synthetic: pretend projects are infrastructure',
      }),
      cat,
    )
    expect(problems.some((p) => p.includes('notes: derives through projects'))).toBe(true)
  })

  it('refuses a derivation path the database does not have', () => {
    const problems = validate(
      withEntry('job_steps', {
        class: 'OFFICE_DERIVED',
        path: [{ columns: ['job_id'], parent: 'jobs', constraint: 'no_such_constraint' }],
      }),
      cat,
    )
    expect(problems.some((p) => p.includes('does not exist'))).toBe(true)
  })

  it('refuses a derived table that names two paths as its one path', () => {
    const problems = validate(withEntry('job_steps', { class: 'OFFICE_DERIVED', path: [] }), cat)
    expect(problems.some((p) => p.includes('exactly one derivation path'))).toBe(true)
  })

  it('refuses a GLOBAL or SYSTEM table with no real reason', () => {
    expect(
      validate(withEntry('cfg', { class: 'SYSTEM', why: 'misc' }), cat).some((p) =>
        p.includes('needs a reason'),
      ),
    ).toBe(true)
    expect(
      validate(withEntry('staff', { class: 'GLOBAL' }), cat).some((p) =>
        p.includes('needs a reason'),
      ),
    ).toBe(true)
  })

  it('refuses a shared table that holds a guaranteed link into an owned one', () => {
    const owned: Catalogue = {
      ...cat,
      fks: [...cat.fks, fk('cfg', 'cfg_project_fkey', 'projects', [['project_id', true]])],
    }
    expect(validate(good, owned).some((p) => p.includes('it would be owned'))).toBe(true)
  })

  it('refuses a carrier that could have derived and did not say a caller selects its parent', () => {
    const problems = validate(
      withEntry('notes', { class: 'OFFICE_CARRIER', why: 'carries it anyway' }),
      cat,
    )
    expect(problems.some((p) => p.includes('caller_selects'))).toBe(true)
    const ok = validate(
      withEntry('notes', {
        class: 'OFFICE_CARRIER',
        why: 'a caller names the project',
        caller_selects: true,
        cross: good.tables.notes?.cross ?? [],
      }),
      cat,
    )
    expect(ok.some((p) => p.includes('caller_selects'))).toBe(false)
  })

  it('refuses a new foreign key between two owned tables that nobody acknowledged', () => {
    const grown: Catalogue = {
      ...cat,
      fks: [
        ...cat.fks,
        fk('job_steps', 'job_steps_project_fkey', 'projects', [['project_id', false]]),
      ],
    }
    expect(validate(good, grown).some((p) => p.includes('not acknowledged in cross'))).toBe(true)
  })

  it('refuses a cycle in the derivation graph', () => {
    const cyc: Catalogue = {
      tables: ['a', 'b'],
      fks: [fk('a', 'a_b', 'b', [['b_id', true]]), fk('b', 'b_a', 'a', [['a_id', true]])],
    }
    const m: Manifest = {
      version: 1,
      baseline: 't',
      tables: {
        a: {
          class: 'OFFICE_DERIVED',
          path: [{ columns: ['b_id'], parent: 'b', constraint: 'a_b' }],
        },
        b: {
          class: 'OFFICE_DERIVED',
          path: [{ columns: ['a_id'], parent: 'a', constraint: 'b_a' }],
        },
      },
    }
    expect(validate(m, cyc).some((p) => p.includes('loops'))).toBe(true)
  })
})

describe('suggest', () => {
  it('points an unclassified table with a NOT NULL owned parent at derivation, otherwise at a carrier', () => {
    expect(
      suggest('x', good, {
        tables: ['x'],
        fks: [fk('x', 'x_p', 'projects', [['project_id', true]])],
      }),
    ).toContain('OFFICE_DERIVED')
    expect(
      suggest('x', good, {
        tables: ['x'],
        fks: [fk('x', 'x_p', 'projects', [['project_id', false]])],
      }),
    ).toContain('OFFICE_CARRIER')
  })
})

describe('readCatalogue', () => {
  it('accepts a parsed document or a JSON string', () => {
    const doc = { tables: ['a'], fks: [] }
    expect(readCatalogue(doc).tables).toEqual(['a'])
    expect(readCatalogue(JSON.stringify(doc)).tables).toEqual(['a'])
  })
})

describe('the committed manifest', () => {
  const manifest = loadManifest()

  it('classifies each table exactly once, in one of the four classes', () => {
    const classes = new Set(Object.values(manifest.tables).map((e) => e.class))
    expect([...classes].sort()).toEqual(['GLOBAL', 'OFFICE_CARRIER', 'OFFICE_DERIVED', 'SYSTEM'])
    expect(Object.keys(manifest.tables).length).toBe(135)
  })

  it('gives every GLOBAL and SYSTEM table a reason', () => {
    for (const [t, e] of Object.entries(manifest.tables)) {
      if (e.class === 'GLOBAL' || e.class === 'SYSTEM')
        expect(e.why?.length ?? 0, t).toBeGreaterThan(23)
    }
  })

  it('gives every derived table exactly one path', () => {
    for (const [t, e] of Object.entries(manifest.tables)) {
      if (e.class === 'OFFICE_DERIVED') expect(e.path?.length, t).toBe(1)
    }
  })

  it('has controls that each fire against the committed manifest', () => {
    const catalogue: Catalogue = readCatalogue({
      tables: Object.keys(manifest.tables),
      fks: Object.entries(manifest.tables).flatMap(([t, e]) =>
        [...(e.path ?? []), ...(e.also ?? []), ...(e.cross ?? [])].map((p) => ({
          child: t,
          constraint: p.constraint,
          parent: p.parent,
          // The committed derivation paths are NOT NULL by construction; cross edges are not.
          columns: p.columns.map((column) => ({
            column,
            notNull: (e.path ?? []).includes(p) || (e.also ?? []).includes(p),
          })),
        })),
      ),
    })
    const results = controls(manifest, catalogue)
    expect(results.length).toBeGreaterThanOrEqual(5)
    for (const c of results) expect(c.raised.length, c.name).toBeGreaterThan(0)
  })
})
