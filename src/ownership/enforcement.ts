/**
 * Is ownership ENFORCED, not just classified? (multi-user P2)
 *
 * `manifest.ts` answers "does every table have a class and does a derived table prove its owner". This answers the
 * question P2 exists for: for each place two owned rows could be linked, is there a structure in the database that
 * refuses a link across offices - whoever the writer is, service role and workers included?
 *
 *   carrier           office_id NOT NULL, a foreign key to offices, an index led by it, write-once, and a bridge
 *   carrier -> carrier an acknowledged edge has a composite (column, office_id) key to (key, office_id), VALIDATED -
 *                     except the named history exceptions, whose key stays NOT VALID and cannot grow
 *   derived edges     a trigger on the child computes both owners and refuses a disagreement and a move
 *   relations         a trigger resolves both polymorphic endpoints
 *   every table       row security on
 *   private names     no unique key left on the bare name/slug of the tables converted to per-office keys
 *
 * The predicate is pure so the same function runs against production, the replica, and a catalogue with one defect
 * injected - which is how the check proves it can fail.
 */
import type { Manifest } from './manifest.ts'

export type EnfFk = {
  readonly child: string
  readonly constraint: string
  readonly parent: string
  readonly columns: readonly string[]
  readonly parentColumns: readonly string[]
  readonly validated: boolean
}
export type EnfColumn = { readonly table: string; readonly notNull: boolean }
export type EnfTrigger = {
  readonly table: string
  readonly name: string
  readonly enabled: boolean
}
export type EnfUnique = { readonly table: string; readonly columns: readonly string[] }
export type EnfRls = { readonly table: string; readonly enabled: boolean }
export type EnfException = { readonly edge: string }

export type EnforcementCatalogue = {
  readonly officeColumns: readonly EnfColumn[]
  readonly fks: readonly EnfFk[]
  readonly triggers: readonly EnfTrigger[]
  readonly officeIndexes: readonly string[]
  readonly uniques: readonly EnfUnique[]
  readonly rls: readonly EnfRls[]
  readonly exceptions: readonly EnfException[]
  /** Transitional facts (P2): active person and sample offices, enabled MCP clients, and whether the MCP conversion is done. */
  /** Public functions with a parameter that names an office: the machine key must never be handed an office to act as. */
  readonly officeParams: readonly string[]
  /** How often the compatibility bridge was relied on, by table and rule - measurable, and it must reach zero in P3. */
  readonly bridgeUse: readonly {
    readonly table: string
    readonly rule: string
    readonly n: number
  }[]
  readonly transitional: {
    readonly realOffices: number
    readonly enabledMcpClients: number
    readonly mcpOfficeBound: boolean
  }
}

/** Tables whose global key on a private name became a per-office key (migration 0662): the bare key must be gone. */
export const PER_OFFICE_NAMES: readonly { table: string; legacy: readonly string[] }[] = [
  { table: 'projects', legacy: ['slug'] },
  { table: 'projects', legacy: ['notebook_ref'] },
  { table: 'responsibilities', legacy: ['slug'] },
  { table: 'event_triggers', legacy: ['name'] },
  { table: 'mcp_providers', legacy: ['name'] },
]

export const ENFORCEMENT_SQL = `
  select jsonb_build_object(
    'officeColumns', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'notNull', a.attnotnull)), '[]'::jsonb)
        from pg_attribute a join pg_class c on c.oid = a.attrelid
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and a.attname = 'office_id' and not a.attisdropped),
    'fks', (select coalesce(jsonb_agg(jsonb_build_object(
          'child', ch.relname, 'constraint', k.conname, 'parent', pa.relname, 'validated', k.convalidated,
          'columns', (select jsonb_agg(a.attname order by u.ord) from unnest(k.conkey) with ordinality u(n, ord)
                        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n),
          'parentColumns', (select jsonb_agg(a.attname order by u.ord) from unnest(k.confkey) with ordinality u(n, ord)
                        join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.n))), '[]'::jsonb)
        from pg_constraint k join pg_class ch on ch.oid = k.conrelid join pg_class pa on pa.oid = k.confrelid
       where k.contype = 'f' and k.connamespace = 'public'::regnamespace),
    'triggers', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'name', t.tgname, 'enabled', t.tgenabled = 'O')), '[]'::jsonb)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
         and t.tgname in ('a0_office_bridge', 'a1_office_write_once', 'a2_office_edges', 'a3_relation_endpoints')),
    'officeIndexes', (select coalesce(jsonb_agg(c.relname), '[]'::jsonb)
        from pg_index i join pg_class c on c.oid = i.indrelid join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where c.relnamespace = 'public'::regnamespace and a.attname = 'office_id'),
    'uniques', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname,
          'columns', (select coalesce(jsonb_agg(a.attname order by u.ord), '[]'::jsonb) from unnest(i.indkey) with ordinality u(n, ord)
                        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.n where u.n > 0))), '[]'::jsonb)
        from pg_index i join pg_class c on c.oid = i.indrelid
       where c.relnamespace = 'public'::regnamespace and i.indisunique and not i.indisprimary),
    'rls', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'enabled', c.relrowsecurity)), '[]'::jsonb)
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and c.relname <> 'isolated_replica_marker'),
    'exceptions', (select coalesce(jsonb_agg(jsonb_build_object('edge', e.edge)), '[]'::jsonb)
        from (select edge from public.office_edge_exceptions) e),
    'officeParams', (select coalesce(jsonb_agg(p.proname || '(' || a.arg || ')'), '[]'::jsonb)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) with ordinality as a(arg, ord)
       where n.nspname = 'public' and a.arg ~* '(^|_)(office|offices)(_id|_key|_ref|_uuid)?$' and a.arg !~* 'rate'
         -- P3: the ONE shape of door that takes an office. The gateway writes it from a verified login; the function
         -- is reachable by the service role alone. Anything else - a different name, a later position, a default, a
         -- grant to a browser role - is a caller choosing its office.
         and not (a.ord = 1 and a.arg = 'p_office' and p.proargtypes[0] = 'uuid'::regtype
                  and p.pronargdefaults < p.pronargs
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not has_function_privilege('authenticated', p.oid, 'execute')
                  and has_function_privilege('service_role', p.oid, 'execute'))),
    'bridgeUse', (select coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'rule', rule, 'n', n)), '[]'::jsonb)
        from public.office_bridge_use),
    'transitional', jsonb_build_object(
        'realOffices', (select count(*) from public.offices where kind in ('person', 'sample') and state = 'active'),
        'enabledMcpClients', (select count(*) from public.mcp_clients where enabled),
        'mcpOfficeBound', coalesce((select (value #>> '{}') = 'true' from public.system_config where key = 'mcp.office_bound'), false))
  ) as enforcement`

export const readEnforcement = (value: unknown): EnforcementCatalogue => {
  const d = (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>
  return {
    officeColumns: (d.officeColumns as EnfColumn[]) ?? [],
    fks: ((d.fks as EnfFk[]) ?? []).map((f) => ({
      ...f,
      columns: f.columns ?? [],
      parentColumns: f.parentColumns ?? [],
    })),
    triggers: (d.triggers as EnfTrigger[]) ?? [],
    officeIndexes: (d.officeIndexes as string[]) ?? [],
    uniques: ((d.uniques as EnfUnique[]) ?? []).map((u) => ({ ...u, columns: u.columns ?? [] })),
    rls: (d.rls as EnfRls[]) ?? [],
    exceptions: (d.exceptions as EnfException[]) ?? [],
    officeParams: (d.officeParams as string[]) ?? [],
    bridgeUse: (d.bridgeUse as EnforcementCatalogue['bridgeUse']) ?? [],
    transitional: (d.transitional as EnforcementCatalogue['transitional']) ?? {
      realOffices: 0,
      enabledMcpClients: 0,
      mcpOfficeBound: false,
    },
  }
}

const eq = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/** Every way an owned table could be linked across offices without the database refusing, as a sentence. */
export const enforcementProblems = (manifest: Manifest, cat: EnforcementCatalogue): string[] => {
  const problems: string[] = []
  const entries = manifest.tables
  const cls = (t: string) => entries[t]?.class
  const trig = (table: string, name: string) =>
    cat.triggers.find((t) => t.table === table && t.name === name)
  const known = new Set(cat.exceptions.map((e) => e.edge))

  for (const [t, e] of Object.entries(entries)) {
    if (e.class === 'OFFICE_CARRIER') {
      const col = cat.officeColumns.find((c) => c.table === t)
      if (col === undefined) problems.push(`${t}: carrier without an office_id column`)
      else if (!col.notNull)
        problems.push(`${t}: office_id is nullable - a row could have no owner`)
      if (
        !cat.fks.some(
          (f) => f.child === t && f.parent === 'offices' && eq(f.columns, ['office_id']),
        )
      )
        problems.push(`${t}: office_id has no foreign key to offices`)
      if (!cat.officeIndexes.includes(t)) problems.push(`${t}: no index led by office_id`)
      const once = trig(t, 'a1_office_write_once')
      if (once === undefined)
        problems.push(`${t}: office_id is not write-once (no a1_office_write_once trigger)`)
      else if (!once.enabled) problems.push(`${t}: the write-once trigger is disabled`)
      if (trig(t, 'a0_office_bridge') === undefined)
        problems.push(
          `${t}: no compatibility bridge trigger, so a legacy writer's insert has no office`,
        )
    }
  }

  // carrier -> owned edges
  for (const [t, e] of Object.entries(entries)) {
    if (e.class !== 'OFFICE_CARRIER') continue
    for (const edge of e.cross ?? []) {
      const parentClass = cls(edge.parent)
      const name = `${t}.${edge.columns.join(',')}`
      if (parentClass === 'OFFICE_CARRIER') {
        const composite = cat.fks.find(
          (f) =>
            f.child === t &&
            f.parent === edge.parent &&
            f.columns.length === edge.columns.length + 1 &&
            eq(f.columns.slice(0, -1), edge.columns) &&
            f.columns[f.columns.length - 1] === 'office_id' &&
            f.parentColumns[f.parentColumns.length - 1] === 'office_id',
        )
        if (composite === undefined)
          problems.push(
            `${name} -> ${edge.parent}: no composite (…, office_id) key, so a row can point into another office`,
          )
        else if (!composite.validated && !known.has(`${t}.${edge.columns.join(',')}`))
          problems.push(
            `${name} -> ${edge.parent}: the composite key is not validated and the edge is not a recorded exception`,
          )
      } else if (parentClass === 'OFFICE_DERIVED') {
        if (
          trig(t, 'a2_office_edges') === undefined ||
          trig(t, 'a2_office_edges')?.enabled !== true
        )
          problems.push(
            `${name} -> ${edge.parent}: a derived parent and no a2_office_edges trigger on ${t}`,
          )
      }
    }
  }

  // derived tables: owner cannot move, second edges agree
  for (const [t, e] of Object.entries(entries)) {
    if (e.class !== 'OFFICE_DERIVED') continue
    const g = trig(t, 'a2_office_edges')
    if (g === undefined)
      problems.push(`${t}: derived and nothing stops its path moving it to another office`)
    else if (!g.enabled) problems.push(`${t}: the a2_office_edges trigger is disabled`)
  }

  const rel = trig('relations', 'a3_relation_endpoints')
  if (rel === undefined || !rel.enabled)
    problems.push(
      "relations: nothing validates the two polymorphic endpoints against the relation's office",
    )

  for (const r of cat.rls) {
    if (!r.enabled) problems.push(`${r.table}: row security is off`)
  }

  for (const p of PER_OFFICE_NAMES) {
    if (cat.uniques.some((u) => u.table === p.table && eq(u.columns, p.legacy)))
      problems.push(
        `${p.table}: a global unique key on (${p.legacy.join(',')}) is back - a second office could not use the same name`,
      )
    if (
      !cat.uniques.some(
        (u) =>
          u.table === p.table &&
          u.columns[0] === 'office_id' &&
          p.legacy.every((c) => u.columns.includes(c)),
      )
    )
      problems.push(`${p.table}: no per-office key including (${p.legacy.join(',')})`)
  }
  // The machine key must never be "a universal token plus an office to act as". The gateway reaches only public functions.
  // P3: a public function may take `p_office` only as its FIRST argument, with no default, executable by the service role
  // alone - the one door the gateway fills from a verified login (or, for the machine key, the test office). Any other
  // office-like argument is a caller choosing its office.
  for (const f of cat.officeParams)
    problems.push(
      `public.${f}: a callable function takes an office in a shape the gateway does not fill (only a first, undefaulted p_office reachable by the service role alone is allowed)`,
    )

  // The transitional rule. Until the MCP gateway resolves its office from the client credential itself, a second real
  // office must not exist while any client can call it: the gateway still speaks for the one person.
  const t = cat.transitional
  if (t.realOffices > 1 && t.enabledMcpClients > 0 && !t.mcpOfficeBound)
    problems.push(
      `a second real office exists (${String(t.realOffices)} active) while ${String(t.enabledMcpClients)} MCP client(s) are enabled and the office-bound MCP conversion is not complete`,
    )
  return problems
}
