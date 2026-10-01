/**
 * Project switching — resolving "which project is this about?".
 *
 * Two halves: recognising a switch instruction, and matching the name in it to
 * a project. The second half is where the danger is.
 *
 * ## Why a near-match must not win
 *
 * Given projects `Pricing Research` and `Pricing Page Rebuild`, "switch to
 * pricing" matches both. The tempting behaviours are to take the closest by
 * edit distance, or the most recently touched. Both produce a confident wrong
 * answer, and a wrong project context is uniquely bad: everything afterwards
 * looks completely normal and is filed in the wrong place. Nothing surfaces it
 * until someone goes looking for work that is not where they left it.
 *
 * So an ambiguous name resolves to `ambiguous`, with the candidates, and the
 * caller asks. This is §6's downward rule applied to a different axis: when
 * two readings are possible, take the one whose error is cheap. Asking costs a
 * message; guessing costs a day of misfiled work.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { OfficeId } from '../office/context.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type ScopeKind = 'slack_channel' | 'telegram_chat' | 'voice' | 'dashboard' | 'global'

export interface Scope {
  readonly kind: ScopeKind
  /** Channel or chat id. The singleton scopes use a fixed marker. */
  readonly ref: string
}

/**
 * Recognise a switch instruction and extract the name.
 *
 * Anchored at the start. "We should switch to a monthly cadence" contains
 * "switch to" and is not a project switch; requiring the instruction to open
 * with the phrase costs a few unusual phrasings and avoids turning a passing
 * remark into a context change.
 */
const SWITCH_PATTERNS: readonly RegExp[] = [
  /^\s*(?:let'?s\s+)?(?:switch|move|change)\s+(?:over\s+)?to\s+(?:the\s+)?(.+?)\s*(?:project)?\s*$/i,
  /^\s*(?:let'?s\s+)?(?:work|focus)\s+on\s+(?:the\s+)?(.+?)\s*(?:project)?\s*$/i,
  /^\s*(?:set|use)\s+(?:the\s+)?(?:current\s+)?project\s+(?:to\s+)?(.+?)\s*$/i,
]

/** Phrases that clear the context rather than setting one. */
const UNSET_PATTERNS: readonly RegExp[] = [
  /^\s*(?:un)?set\s+(?:the\s+)?project\s+(?:to\s+)?(?:none|nothing|null)\s*$/i,
  /^\s*(?:clear|forget|drop)\s+(?:the\s+)?(?:current\s+)?project\s*$/i,
  /^\s*no\s+project\s*$/i,
]

export type SwitchIntent =
  | { readonly kind: 'switch'; readonly name: string }
  | { readonly kind: 'unset' }
  | { readonly kind: 'none' }

export const parseSwitch = (instruction: string): SwitchIntent => {
  const text = instruction.trim()
  for (const p of UNSET_PATTERNS) if (p.test(text)) return { kind: 'unset' }
  for (const p of SWITCH_PATTERNS) {
    const m = p.exec(text)
    const name = m?.[1]?.trim()
    // A one- or two-character "name" is far more likely to be a misparse than
    // a project, and a misparsed switch is a silent context change.
    if (name !== undefined && name.length >= 3) return { kind: 'switch', name }
  }
  return { kind: 'none' }
}

export interface ProjectMatch {
  readonly projectId: string
  readonly slug: string
  readonly name: string
}

export type Resolution =
  | { readonly kind: 'matched'; readonly project: ProjectMatch }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly ProjectMatch[] }
  | { readonly kind: 'not_found'; readonly searched: string }

/**
 * Match a spoken name to exactly one active project.
 *
 * Tries progressively looser rules and **stops at the first tier that
 * matches**, rather than pooling all matches. A tiered search means an exact
 * name is never made ambiguous by some other project that merely contains the
 * word — which is the common case, and the one where asking would be annoying
 * rather than careful.
 */
export const matchProject = async (
  db: SqlExecutor,
  /** Whose projects are searched. A name is only ever matched against one office's own. */
  office: OfficeId,
  name: string,
): Promise<Resolution> => {
  const needle = name.trim().toLowerCase()
  if (needle === '') return { kind: 'not_found', searched: name }

  const rows = await db.execute(`
    select project_id::text as project_id, slug, name
    from public.projects
    where office_id = ${lit(office)}::uuid and status = 'active' order by name
  `)
  const all: ProjectMatch[] = rows.rows.map((r) => ({
    projectId: String(r.project_id),
    slug: String(r.slug),
    name: String(r.name),
  }))

  const tiers: readonly ProjectMatch[][] = [
    all.filter((p) => p.name.toLowerCase() === needle || p.slug === needle),
    all.filter((p) => p.slug === needle.replace(/\s+/g, '-')),
    all.filter((p) => p.name.toLowerCase().startsWith(needle)),
    all.filter((p) => p.name.toLowerCase().includes(needle) || p.slug.includes(needle)),
  ]

  for (const tier of tiers) {
    if (tier.length === 1) return { kind: 'matched', project: tier[0] as ProjectMatch }
    if (tier.length > 1) return { kind: 'ambiguous', candidates: tier }
  }
  return { kind: 'not_found', searched: name }
}

/** Record a switch. Insert only — 0026 revokes update. */
export const switchTo = async (
  db: SqlExecutor,
  /** The office whose chat is switching; the project named must be one of its own. */
  office: OfficeId,
  scope: Scope,
  projectId: string | null,
  by: string,
  reason: string,
): Promise<string> => {
  const { rows } = await db.execute(`
    insert into public.project_switches
      (scope_kind, scope_ref, project_id, switched_by, reason, office_id)
    select ${lit(scope.kind)}::public.project_scope_kind, ${lit(scope.ref)},
            ${projectId === null ? 'null' : `${lit(projectId)}::uuid`},
            ${lit(by)}, ${lit(reason)}, ${lit(office)}::uuid
     where app.require_office(${lit(office)}::uuid) is not null
       and ${projectId === null ? 'true' : `exists (select 1 from public.projects p where p.project_id = ${lit(projectId)}::uuid and p.office_id = ${lit(office)}::uuid)`}
    returning switch_id::text as id
  `)
  // A project of another office is refused exactly as a missing one is: nothing is written.
  if (rows[0] === undefined) throw new Error('no_such_project')
  return String(rows[0]?.id)
}

/**
 * Which project is this scope about?
 *
 * Delegates to `app.resolve_project` rather than reimplementing the order.
 * Two implementations of a precedence rule is one implementation and one bug.
 */
export const resolveProject = async (
  db: SqlExecutor,
  scope: Scope,
  explicitProjectId?: string,
): Promise<string | null> => {
  const { rows } = await db.execute(`
    select app.resolve_project(
      ${lit(scope.kind)}::public.project_scope_kind,
      ${lit(scope.ref)},
      ${explicitProjectId === undefined ? 'null' : `${lit(explicitProjectId)}::uuid`}
    )::text as project_id
  `)
  const id = rows[0]?.project_id
  return id === null || id === undefined ? null : String(id)
}

/** The message to send when the name did not resolve. Never a guess. */
export const clarificationFor = (r: Resolution): string => {
  if (r.kind === 'ambiguous') {
    return (
      `That matches ${String(r.candidates.length)} projects: ` +
      `${r.candidates.map((c) => c.name).join(', ')}. Which one?`
    )
  }
  if (r.kind === 'not_found') {
    return `I have no active project matching "${r.searched}".`
  }
  return ''
}
