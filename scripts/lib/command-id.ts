/**
 * How a job's `pinned_config.command_id` is read by the witnesses.
 *
 * `command_id` is JSON text, so it may be a valid uuid, absent, an empty string, or something else. A hand-off
 * child created by a duty carries an EMPTY string (the Sample's `riverside-caf-launch-auto` duty did, 5 October),
 * and a bare `(x)::uuid` raises 22P02 for it, which killed `check:leaks` before it printed a verdict.
 *
 * Two different facts must stay apart:
 *   - a LEAK finding: the evidence of a job's origin was deleted, or a harness job reads as real;
 *   - a DATA-QUALITY finding: the command_id could not be parsed, so nothing can be said about its origin.
 * The second is reported under its own heading and never counted as the first, and never hides it.
 */
const UUID_SHAPE = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

/** SQL that yields the uuid for a JSON text expression, or NULL when it is absent, empty or malformed. */
export const commandIdUuidSql = (textExpr: string): string =>
  `(case when ${textExpr} ~* '${UUID_SHAPE}' then (${textExpr})::uuid end)`

/** SQL that is true when a command_id is present but cannot be read as a uuid (empty counts: it is present). */
export const commandIdUnreadableSql = (jsonbExpr: string): string =>
  `(${jsonbExpr} ? 'command_id' and (${jsonbExpr} ->> 'command_id') is not null ` +
  `and (${jsonbExpr} ->> 'command_id') !~* '${UUID_SHAPE}')`

export type CommandIdKind = 'uuid' | 'absent' | 'empty' | 'malformed'

/** The same classification in TypeScript, so the rule is stated once and unit-tested without a database. */
export const classifyCommandId = (v: unknown): CommandIdKind => {
  if (v === null || v === undefined) return 'absent'
  if (typeof v !== 'string') return 'malformed'
  if (v === '') return 'empty'
  return new RegExp(UUID_SHAPE, 'i').test(v) ? 'uuid' : 'malformed'
}
