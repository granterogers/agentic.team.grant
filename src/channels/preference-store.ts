/**
 * Persisting a parsed preference, and the instruction that produced it.
 *
 * Both writes belong together and neither is optional: an applied preference
 * with no recorded instruction is unexplainable later, and a recorded
 * instruction with no applied preference is a lie. They are one function for
 * that reason.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { ParsedPreference, ParseResult } from './preferences.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | undefined): string => (v === undefined ? 'null' : lit(v))

export interface ApplyContext {
  readonly subject?: string
  readonly originChannel: 'slack' | 'telegram' | 'voice' | 'teamhq'
  readonly instruction: string
  readonly commandId?: string | undefined
  readonly projectId?: string | undefined
  /** 'rules', or the model identifier if a model produced the parse. */
  readonly interpretedBy?: string
}

export interface ApplyOutcome {
  readonly applied: boolean
  readonly instructionId: string
  /** What to tell Grant. Null when the preference was applied cleanly. */
  readonly notUnderstood: string | null
}

/**
 * Apply a parse result.
 *
 * An unrecognised instruction still writes an audit row. That is the point of
 * `not_understood` being a column: a pattern of misses is only visible if the
 * misses are recorded, and Grant gets told which words were not understood
 * rather than nothing happening.
 */
export const applyPreference = async (
  db: SqlExecutor,
  parse: ParseResult,
  ctx: ApplyContext,
): Promise<ApplyOutcome> => {
  const subject = ctx.subject ?? 'grant'
  const by = ctx.interpretedBy ?? 'rules'

  if (parse.notUnderstood !== null) {
    const { rows } = await db.execute(`
      insert into public.preference_instructions
        (subject, origin_channel, command_id, instruction, interpreted_as,
         interpreted_by, not_understood)
      values
        (${lit(subject)}, ${lit(ctx.originChannel)}, ${nul(ctx.commandId)}::uuid,
         ${lit(ctx.instruction)}, '{}'::jsonb, ${lit(by)}, ${lit(parse.notUnderstood)})
      returning instruction_id::text as instruction_id
    `)
    return {
      applied: false,
      instructionId: String(rows[0]?.instruction_id),
      notUnderstood: parse.notUnderstood,
    }
  }

  const p = parse.preference
  const sets: string[] = []
  const cols: { col: string; value: string }[] = []

  if (p.minSeverity !== undefined) {
    cols.push({ col: 'min_severity', value: `${lit(p.minSeverity)}::public.notify_severity` })
  }
  if (p.quietForMs !== undefined) {
    // Computed in SQL from the database clock rather than from this process's
    // clock: two machines with different times must produce the same window,
    // and app.now_utc() is the one clock the whole system already agrees on.
    cols.push({
      col: 'quiet_until',
      value: `app.now_utc() + make_interval(secs => ${String(Math.round(p.quietForMs / 1000))})`,
    })
  }
  if (p.mutedChannels !== undefined) {
    cols.push({
      col: 'muted_channels',
      value: `array[${p.mutedChannels.map((c) => lit(c)).join(', ')}]::text[]`,
    })
  }
  if (p.digestMode !== undefined) {
    cols.push({ col: 'digest_mode', value: lit(p.digestMode) })
  }
  if (p.blockersAlways !== undefined) {
    cols.push({ col: 'blockers_always', value: p.blockersAlways ? 'true' : 'false' })
  }

  for (const c of cols) sets.push(`${c.col} = excluded.${c.col}`)

  // One row per scope, updated in place: the *current* preference is what the
  // resolver reads, and the history lives in preference_instructions. Two
  // tables, two jobs — a history table that also has to answer "what applies
  // right now" needs a query that can be wrong.
  const conflictTarget =
    ctx.projectId === undefined
      ? '(subject) where project_id is null'
      : '(subject, project_id) where project_id is not null'

  await db.execute(`
    insert into public.notification_preferences
      (subject, project_id, ${cols.map((c) => c.col).join(', ')})
    values
      (${lit(subject)}, ${nul(ctx.projectId)}::uuid, ${cols.map((c) => c.value).join(', ')})
    on conflict ${conflictTarget}
      do update set ${sets.join(', ')}
  `)

  const { rows } = await db.execute(`
    insert into public.preference_instructions
      (subject, origin_channel, command_id, instruction, interpreted_as, interpreted_by)
    values
      (${lit(subject)}, ${lit(ctx.originChannel)}, ${nul(ctx.commandId)}::uuid,
       ${lit(ctx.instruction)}, ${lit(JSON.stringify(auditShape(p, parse.matched)))}::jsonb,
       ${lit(by)})
    returning instruction_id::text as instruction_id
  `)

  return { applied: true, instructionId: String(rows[0]?.instruction_id), notUnderstood: null }
}

/**
 * What goes in `interpreted_as`.
 *
 * The rule names are included alongside the effects, because "which rule fired"
 * is the question asked when an interpretation looks wrong, and reconstructing
 * it from the effects afterwards is guesswork.
 */
const auditShape = (p: ParsedPreference, matched: readonly string[]): Record<string, unknown> => ({
  ...(p.minSeverity === undefined ? {} : { min_severity: p.minSeverity }),
  ...(p.quietForMs === undefined ? {} : { quiet_for_ms: p.quietForMs }),
  ...(p.mutedChannels === undefined ? {} : { muted_channels: p.mutedChannels }),
  ...(p.digestMode === undefined ? {} : { digest_mode: p.digestMode }),
  ...(p.blockersAlways === undefined ? {} : { blockers_always: p.blockersAlways }),
  rules: matched,
})

/** Clear a scope's preference. Used by "tell me everything" and by tests. */
export const clearPreference = async (
  db: SqlExecutor,
  subject = 'grant',
  projectId?: string,
): Promise<void> => {
  await db.execute(`
    delete from public.notification_preferences
    where subject = ${lit(subject)}
      and project_id ${projectId === undefined ? 'is null' : `= ${lit(projectId)}::uuid`}
  `)
}
