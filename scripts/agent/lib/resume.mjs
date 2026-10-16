/**
 * The prompt a resumed session is started with. It is built from the ledger alone, so a new process knows what to do
 * without any memory of the one that ended. Pure.
 *
 * Options: readFirst lists the files a session must read before it acts (the default names the mission documents), and
 * sessionInstruction is one extra line for this launch only (a trial uses it to limit how much one session does).
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { classify } from './gate.mjs'

const DEFAULT_READ_FIRST = ['docs/agent/CURRENT-MISSION.md', 'docs/agent/CONTINUITY.md']

export function resumePrompt(state, options = {}) {
  const m = state.mission
  if (!m) return 'No mission is recorded. Stop.'
  const readFirst = options.readFirst ?? DEFAULT_READ_FIRST
  const { actionable, blocked, done } = classify(m)
  const lines = [
    `Resume mission ${m.id}: ${m.title}.`,
    `Read ${readFirst.join(' and ')} first. The mission is authorised until ${m.deadline}.`,
    `Branch: ${m.branch}. Last checkpoint: ${m.lastCheckpoint?.summary ?? 'none recorded'}.`,
    `Done: ${done.map((r) => r.id).join(', ') || 'none yet'}.`,
    'Still to do:',
    ...actionable.map((r) => `  - ${r.id} ${r.title}`),
  ]
  if (blocked.length > 0) lines.push(`Waiting on Grant (do not stop for these): ${blocked.map((r) => r.id).join(', ')}.`)
  const next = (m.nextAction ?? 'choose the next open requirement').replace(/\.+$/, '')
  lines.push(`Next action: ${next}.`)
  lines.push('Record a checkpoint in the mission state file after each completed unit, and continue.')
  if (options.sessionInstruction) lines.push(options.sessionInstruction)
  return lines.join('\n')
}
