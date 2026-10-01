import { describe, expect, it } from 'vitest'
import {
  type EnforcementCatalogue,
  enforcementProblems,
  PER_OFFICE_NAMES,
} from '../../src/ownership/enforcement.ts'
import type { Manifest } from '../../src/ownership/manifest.ts'

const manifest: Manifest = {
  version: 1,
  baseline: 'test',
  tables: {
    projects: { class: 'OFFICE_CARRIER', caller_selects: true },
    jobs: {
      class: 'OFFICE_CARRIER',
      caller_selects: true,
      cross: [{ columns: ['project_id'], parent: 'projects', constraint: 'jobs_project_id_fkey' }],
    },
    traces: {
      class: 'OFFICE_DERIVED',
      path: [{ columns: ['job_id'], parent: 'jobs', constraint: 'traces_job_id_fkey' }],
    },
    offices: { class: 'SYSTEM', why: 'the ownership primitive itself, never owned by an office' },
  },
}

const good: EnforcementCatalogue = {
  officeColumns: [
    { table: 'projects', notNull: true },
    { table: 'jobs', notNull: true },
  ],
  fks: [
    {
      child: 'projects',
      constraint: 'projects_office_fk',
      parent: 'offices',
      columns: ['office_id'],
      parentColumns: ['office_id'],
      validated: true,
    },
    {
      child: 'jobs',
      constraint: 'jobs_office_fk',
      parent: 'offices',
      columns: ['office_id'],
      parentColumns: ['office_id'],
      validated: true,
    },
    {
      child: 'jobs',
      constraint: 'jobs_project_same_office',
      parent: 'projects',
      columns: ['project_id', 'office_id'],
      parentColumns: ['project_id', 'office_id'],
      validated: true,
    },
  ],
  triggers: [
    ...['projects', 'jobs'].flatMap((table) => [
      { table, name: 'a0_office_bridge', enabled: true },
      { table, name: 'a1_office_write_once', enabled: true },
    ]),
    { table: 'traces', name: 'a2_office_edges', enabled: true },
    { table: 'relations', name: 'a3_relation_endpoints', enabled: true },
  ],
  officeIndexes: ['projects', 'jobs'],
  uniques: PER_OFFICE_NAMES.map((p) => ({ table: p.table, columns: ['office_id', ...p.legacy] })),
  rls: [{ table: 'projects', enabled: true }],
  exceptions: [],
  officeParams: [],
  bridgeUse: [],
  transitional: { realOffices: 1, enabledMcpClients: 2, mcpOfficeBound: false },
}

describe('enforcementProblems', () => {
  it('accepts a catalogue in which every edge is enforced', () => {
    expect(enforcementProblems(manifest, good)).toEqual([])
  })

  it('refuses a carrier edge whose composite key is gone', () => {
    const cat = {
      ...good,
      fks: good.fks.filter((f) => f.constraint !== 'jobs_project_same_office'),
    }
    expect(enforcementProblems(manifest, cat).join('\n')).toContain('no composite')
  })

  it('refuses a composite key that is not validated unless the edge is a recorded exception', () => {
    const loose = {
      ...good,
      fks: good.fks.map((f) =>
        f.constraint === 'jobs_project_same_office' ? { ...f, validated: false } : f,
      ),
    }
    expect(enforcementProblems(manifest, loose).join('\n')).toContain('not validated')
    expect(
      enforcementProblems(manifest, { ...loose, exceptions: [{ edge: 'jobs.project_id' }] }),
    ).toEqual([])
  })

  it('refuses a composite key whose parent side is not (key, office_id)', () => {
    const cat = {
      ...good,
      fks: good.fks.map((f) =>
        f.constraint === 'jobs_project_same_office'
          ? { ...f, parentColumns: ['project_id', 'slug'] }
          : f,
      ),
    }
    expect(enforcementProblems(manifest, cat).join('\n')).toContain('no composite')
  })

  it('refuses a carrier whose office_id may be null, is not write-once, or has no bridge', () => {
    expect(
      enforcementProblems(manifest, {
        ...good,
        officeColumns: [
          { table: 'projects', notNull: false },
          { table: 'jobs', notNull: true },
        ],
      }).join('\n'),
    ).toContain('nullable')
    expect(
      enforcementProblems(manifest, {
        ...good,
        triggers: good.triggers.map((t) =>
          t.table === 'jobs' && t.name === 'a1_office_write_once' ? { ...t, enabled: false } : t,
        ),
      }).join('\n'),
    ).toContain('disabled')
    expect(
      enforcementProblems(manifest, {
        ...good,
        triggers: good.triggers.filter(
          (t) => !(t.table === 'projects' && t.name === 'a0_office_bridge'),
        ),
      }).join('\n'),
    ).toContain('bridge')
  })

  it('refuses a derived table with nothing stopping it moving, and a missing relations guard', () => {
    expect(
      enforcementProblems(manifest, {
        ...good,
        triggers: good.triggers.filter((t) => t.table !== 'traces'),
      }).join('\n'),
    ).toContain('traces')
    expect(
      enforcementProblems(manifest, {
        ...good,
        triggers: good.triggers.filter((t) => t.name !== 'a3_relation_endpoints'),
      }).join('\n'),
    ).toContain('relations')
  })

  it('refuses a second real office while an MCP client is enabled and the conversion is not done', () => {
    const two = {
      ...good,
      transitional: { realOffices: 2, enabledMcpClients: 2, mcpOfficeBound: false },
    }
    expect(enforcementProblems(manifest, two).join('\n')).toContain('office-bound MCP conversion')
    expect(
      enforcementProblems(manifest, {
        ...two,
        transitional: { ...two.transitional, mcpOfficeBound: true },
      }),
    ).toEqual([])
    expect(
      enforcementProblems(manifest, {
        ...two,
        transitional: { ...two.transitional, enabledMcpClients: 0 },
      }),
    ).toEqual([])
  })

  it('refuses a callable function that takes an office from its caller', () => {
    expect(
      enforcementProblems(manifest, { ...good, officeParams: ['hq_x(p_office)'] }).join('\n'),
    ).toContain('takes an office')
  })

  it('refuses a table with row security off', () => {
    expect(
      enforcementProblems(manifest, { ...good, rls: [{ table: 'projects', enabled: false }] }).join(
        '\n',
      ),
    ).toContain('row security')
  })

  it('refuses a global unique key on a private name, and a missing per-office key', () => {
    expect(
      enforcementProblems(manifest, {
        ...good,
        uniques: [...good.uniques, { table: 'projects', columns: ['slug'] }],
      }).join('\n'),
    ).toContain('global unique key')
    expect(
      enforcementProblems(manifest, {
        ...good,
        uniques: good.uniques.filter((u) => u.table !== 'responsibilities'),
      }).join('\n'),
    ).toContain('no per-office key')
  })
})
