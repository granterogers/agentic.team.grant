/**
 * Reading the operator's command line for scripts/ops/activity-switch.ts. Pure, so every refusal is tested without a database.
 * Unknown options, repeated options, two operations at once, a missing value and `--apply` without an operation are all refused; the
 * default (no operation) is a read-only status, and nothing is written unless `--apply` is present.
 */
import type { SwitchRequest } from './switch.ts'

export const KNOWN_FLAGS = [
  '--canary',
  '--add',
  '--remove',
  '--off',
  '--all-offices',
  '--confirm',
  '--apply',
  '--dry-run',
  '--status',
] as const
const TAKES_VALUE = new Set(['--canary', '--add', '--remove', '--confirm'])
const OPERATIONS = ['--canary', '--add', '--remove', '--off', '--all-offices', '--status'] as const

export type Parsed =
  | { readonly ok: true; readonly request: SwitchRequest; readonly apply: boolean }
  | { readonly ok: false; readonly refusal: string }

export const parseSwitchArgs = (argv: readonly string[]): Parsed => {
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? ''
    if (!raw.startsWith('--'))
      return { ok: false, refusal: `unexpected argument ${JSON.stringify(raw)}` }
    const eq = raw.indexOf('=')
    const name = eq < 0 ? raw : raw.slice(0, eq)
    const inline = eq < 0 ? undefined : raw.slice(eq + 1)
    if (!(KNOWN_FLAGS as readonly string[]).includes(name))
      return {
        ok: false,
        refusal: `unknown option ${JSON.stringify(name)}. Known: ${KNOWN_FLAGS.join(' ')}`,
      }
    if (flags.has(name)) return { ok: false, refusal: `${name} given twice` }
    if (TAKES_VALUE.has(name)) {
      const value = inline ?? argv[++i] ?? ''
      if (value === '' || value.startsWith('--'))
        return { ok: false, refusal: `${name} needs a value` }
      flags.set(name, value)
    } else if (inline !== undefined) return { ok: false, refusal: `${name} takes no value` }
    else flags.set(name, '')
  }
  const apply = flags.has('--apply')
  if (apply && flags.has('--dry-run'))
    return { ok: false, refusal: '--apply and --dry-run contradict each other' }
  const ops = OPERATIONS.filter((o) => flags.has(o))
  if (ops.length > 1)
    return { ok: false, refusal: `one operation at a time, got ${ops.join(' and ')}` }
  const ids = (k: string): string[] =>
    (flags.get(k) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
  const op = ops[0]
  if (flags.has('--confirm') && op !== '--all-offices')
    return { ok: false, refusal: '--confirm belongs to --all-offices only' }
  let request: SwitchRequest
  if (op === undefined || op === '--status') request = { kind: 'status' }
  else if (op === '--canary') request = { kind: 'canary', offices: ids('--canary') }
  else if (op === '--add') request = { kind: 'add', offices: ids('--add') }
  else if (op === '--remove') request = { kind: 'remove', offices: ids('--remove') }
  else if (op === '--off') request = { kind: 'off' }
  else request = { kind: 'all', confirm: flags.get('--confirm') ?? '' }
  if (apply && request.kind === 'status')
    return {
      ok: false,
      refusal: '--apply needs an operation (--canary, --add, --remove, --off or --all-offices)',
    }
  return { ok: true, request, apply }
}
