/**
 * The ownership manifest: every table in `public` is classified exactly once, and a table that
 * derives its owner proves it structurally.
 *
 * Multi-user P0. docs/multi-user/ARCHITECTURE.md decides WHAT the classes mean; this module is the
 * machine that refuses a catalogue the manifest does not account for. It does not build the
 * `offices` schema and nothing here touches ownership at run time.
 *
 * ## The four classes
 *
 *   OFFICE_CARRIER  carries `office_id` itself (a root, a press target, a binding, or a row whose
 *                   parent a CALLER selects - then the parent is CHECKED against the carried owner).
 *   OFFICE_DERIVED  has no owner column. Its owner is its parent's, through a foreign key whose
 *                   columns are all NOT NULL in the SCHEMA.
 *   GLOBAL          intentionally shared by every office (a catalogue, a product definition).
 *   SYSTEM          deployment infrastructure or harness state no human office may own.
 *
 * ## The rule the first research draft broke
 *
 * A table may derive only if the schema GUARANTEES its parent. `decisions.project_id` has no null
 * rows today and is nullable, so a row written tomorrow with a null project would have no owner.
 * The research draft called ten such tables "derived via project_id"; measuring the constraint,
 * not the rows, moved them to carriers. `validate` asserts `attnotnull`, never row contents.
 *
 * ## What it refuses
 *
 *   - a table with no entry, or an entry for a table that does not exist;
 *   - a GLOBAL or SYSTEM table with no reason, or one that holds a NOT NULL foreign key into an
 *     owned table (it would be owned);
 *   - a DERIVED table whose path is missing, absent from the catalogue, nullable, cyclic, or whose
 *     parent is not itself owned;
 *   - a CARRIER that could have derived and did not say why not (`caller_selects`);
 *   - an unacknowledged foreign key between two owned tables. Every such edge is a place two
 *     offices could be linked, and the future composite key (or function check) is decided per
 *     edge, so a new one must be looked at: it is listed in `cross` or this fails.
 */

export type OwnershipClass = 'OFFICE_CARRIER' | 'OFFICE_DERIVED' | 'GLOBAL' | 'SYSTEM'

export type FkPath = {
  readonly columns: readonly string[]
  readonly parent: string
  readonly constraint: string
}

export type ManifestEntry = {
  readonly class: OwnershipClass
  readonly why?: string
  /** OFFICE_DERIVED: the single guaranteed path that decides the owner. */
  readonly path?: readonly FkPath[]
  /** OFFICE_DERIVED: further NOT NULL paths; each is a place two owners could disagree. */
  readonly also?: readonly FkPath[]
  /** OFFICE_CARRIER: the parent is chosen by a caller, so it records the owner itself. */
  readonly caller_selects?: boolean
  /** Foreign keys to another owned table that are not the derivation path. */
  readonly cross?: readonly FkPath[]
}

export type Manifest = {
  readonly version: number
  readonly baseline: string
  readonly tables: Readonly<Record<string, ManifestEntry>>
}

export type CatalogueFk = {
  readonly child: string
  readonly constraint: string
  readonly parent: string
  /** Column names in constraint order, with their schema NOT NULL flag. */
  readonly columns: readonly { readonly column: string; readonly notNull: boolean }[]
}

export type Catalogue = {
  readonly tables: readonly string[]
  readonly fks: readonly CatalogueFk[]
}

export const CLASSES: readonly OwnershipClass[] = [
  'OFFICE_CARRIER',
  'OFFICE_DERIVED',
  'GLOBAL',
  'SYSTEM',
]

const MIN_REASON = 24

/** The catalogue question, as one JSON document so a replica and production answer it identically. */
export const CATALOGUE_SQL = `
  select jsonb_build_object(
    'tables', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
                 from pg_class c
                where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
                  and c.relname <> 'isolated_replica_marker'),
    'fks', (select coalesce(jsonb_agg(jsonb_build_object(
                     'child', k.conrelid::regclass::text, 'constraint', k.conname,
                     'parent', k.confrelid::regclass::text,
                     'columns', (select jsonb_agg(jsonb_build_object('column', a.attname, 'notNull', a.attnotnull)
                                                  order by u.ord)
                                   from unnest(k.conkey) with ordinality u(attnum, ord)
                                   join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum))
                     order by k.conrelid::regclass::text, k.conname), '[]'::jsonb)
              from pg_constraint k
             where k.contype = 'f' and k.connamespace = 'public'::regnamespace
               and k.conrelid::regclass::text not like 'isolated_replica%')) as catalogue`

export const readCatalogue = (value: unknown): Catalogue => {
  const doc = (typeof value === 'string' ? JSON.parse(value) : value) as {
    tables?: unknown
    fks?: unknown
  }
  return {
    tables: (doc.tables as string[]) ?? [],
    fks: (doc.fks as CatalogueFk[]) ?? [],
  }
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

const isOwned = (cls: OwnershipClass | undefined): boolean =>
  cls === 'OFFICE_CARRIER' || cls === 'OFFICE_DERIVED'

/** Every problem, as a sentence that names the table; empty means the manifest accounts for the catalogue. */
export const validate = (manifest: Manifest, cat: Catalogue): string[] => {
  const problems: string[] = []
  const entries = manifest.tables
  const present = new Set(cat.tables)

  for (const t of cat.tables) {
    if (entries[t] === undefined) {
      problems.push(`${t}: UNCLASSIFIED - a table with no ownership class (add it to the manifest)`)
    }
  }
  for (const t of Object.keys(entries)) {
    if (!present.has(t)) problems.push(`${t}: in the manifest but not in the database`)
  }

  const clsOf = (t: string): OwnershipClass | undefined => entries[t]?.class
  const fkOf = (child: string, constraint: string): CatalogueFk | undefined =>
    cat.fks.find((f) => f.child === child && f.constraint === constraint)

  for (const [t, e] of Object.entries(entries)) {
    if (!present.has(t)) continue
    if (!CLASSES.includes(e.class)) {
      problems.push(`${t}: class "${String(e.class)}" is not one of ${CLASSES.join(', ')}`)
      continue
    }
    if (
      (e.class === 'GLOBAL' || e.class === 'SYSTEM') &&
      (e.why ?? '').trim().length < MIN_REASON
    ) {
      problems.push(`${t}: ${e.class} needs a reason of at least ${MIN_REASON} characters`)
    }
    if (e.class === 'OFFICE_CARRIER' && (e.why ?? '').trim() === '') {
      problems.push(`${t}: OFFICE_CARRIER needs a reason (why it cannot derive)`)
    }
  }

  const checkPath = (child: string, p: FkPath, label: string): void => {
    const fk = fkOf(child, p.constraint)
    if (fk === undefined) {
      problems.push(`${child}: ${label} names constraint ${p.constraint}, which does not exist`)
      return
    }
    if (
      fk.parent !== p.parent ||
      !same(
        fk.columns.map((c) => c.column),
        p.columns,
      )
    ) {
      problems.push(
        `${child}: ${label} ${p.constraint} says ${p.columns.join(',')} -> ${p.parent} but the database has ${fk.columns
          .map((c) => c.column)
          .join(',')} -> ${fk.parent}`,
      )
    }
  }

  for (const [t, e] of Object.entries(entries)) {
    if (!present.has(t) || e.class !== 'OFFICE_DERIVED') continue
    const paths = e.path ?? []
    if (paths.length !== 1) {
      problems.push(
        `${t}: OFFICE_DERIVED needs exactly one derivation path (has ${String(paths.length)})`,
      )
      continue
    }
    for (const p of [...paths, ...(e.also ?? [])]) {
      checkPath(t, p, 'path')
      const fk = fkOf(t, p.constraint)
      if (fk === undefined) continue
      const nullable = fk.columns.filter((c) => !c.notNull).map((c) => c.column)
      if (nullable.length > 0) {
        problems.push(
          `${t}: ${p.constraint} is nullable in the schema (${nullable.join(', ')}) - a row could have no owner. Make it a carrier`,
        )
      }
      if (!isOwned(clsOf(p.parent))) {
        problems.push(
          `${t}: derives through ${p.parent}, which is ${clsOf(p.parent) ?? 'unclassified'}, not owned`,
        )
      }
    }
  }

  // The derivation graph must be acyclic and must end in a carrier.
  for (const [t, e] of Object.entries(entries)) {
    if (e.class !== 'OFFICE_DERIVED') continue
    const seen = new Set<string>()
    let at: string | undefined = t
    while (at !== undefined && entries[at]?.class === 'OFFICE_DERIVED') {
      if (seen.has(at)) {
        problems.push(`${t}: its derivation path loops (${[...seen, at].join(' -> ')})`)
        break
      }
      seen.add(at)
      at = entries[at]?.path?.[0]?.parent
    }
  }

  // A shared or infrastructure table that holds a guaranteed link into an owned one is owned.
  for (const f of cat.fks) {
    const c = clsOf(f.child)
    if (
      (c === 'GLOBAL' || c === 'SYSTEM') &&
      isOwned(clsOf(f.parent)) &&
      f.columns.every((x) => x.notNull)
    ) {
      problems.push(
        `${f.child}: ${c} but ${f.constraint} is a NOT NULL link into owned ${f.parent} - it would be owned`,
      )
    }
  }

  // A carrier that could have derived must say a caller selects its parent.
  for (const [t, e] of Object.entries(entries)) {
    if (!present.has(t) || e.class !== 'OFFICE_CARRIER') continue
    const couldDerive = cat.fks.some(
      (f) =>
        f.child === t &&
        f.parent !== t &&
        isOwned(clsOf(f.parent)) &&
        f.columns.every((c) => c.notNull),
    )
    if (couldDerive && e.caller_selects !== true) {
      problems.push(
        `${t}: carries its owner although a NOT NULL path exists - say caller_selects or derive`,
      )
    }
  }

  // Every other FK between two owned tables is acknowledged: it is a place two offices could be linked.
  for (const f of cat.fks) {
    const child = entries[f.child]
    if (child === undefined || !isOwned(child.class) || !isOwned(clsOf(f.parent))) continue
    const chosen = [...(child.path ?? []), ...(child.also ?? [])].some(
      (p) => p.constraint === f.constraint,
    )
    const listed = (child.cross ?? []).some((p) => p.constraint === f.constraint)
    if (!chosen && !listed) {
      problems.push(
        `${f.child}: ${f.constraint} (${f.columns.map((c) => c.column).join(',')} -> ${f.parent}) links two owned tables and is not acknowledged in cross`,
      )
    }
  }
  for (const [t, e] of Object.entries(entries)) {
    for (const p of e.cross ?? []) {
      if (fkOf(t, p.constraint) === undefined) {
        problems.push(`${t}: cross lists ${p.constraint}, which does not exist`)
      }
    }
  }

  return problems
}

/** A suggestion for an unclassified table, so adding one is a decision with a starting point. */
export const suggest = (table: string, manifest: Manifest, cat: Catalogue): string => {
  const owned = (t: string): boolean => isOwned(manifest.tables[t]?.class)
  const paths = cat.fks.filter(
    (f) =>
      f.child === table &&
      f.parent !== table &&
      owned(f.parent) &&
      f.columns.every((c) => c.notNull),
  )
  if (paths.length === 0) {
    return `${table}: no NOT NULL foreign key into an owned table -> OFFICE_CARRIER (or GLOBAL/SYSTEM with a reason)`
  }
  return `${table}: NOT NULL path ${paths.map((p) => `${p.columns.map((c) => c.column).join(',')} -> ${p.parent}`).join(' | ')} -> OFFICE_DERIVED (unless a caller selects the parent)`
}
