/**
 * The prompt a resumed session is started with. It is built from the ledger alone, so a new process knows what to do
 * without any memory of the one that ended. Pure.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { classify } from './gate.mjs'

export function resumePrompt(state) {
  const m = state.mission
  if (!m) return 'No mission is recorded. Stop.'
  const { actionable, blocked, done } = classify(m)
  const lines = [
    `Resume mission ${m.id}: ${m.title}.`,
    `Read docs/agent/CURRENT-MISSION.md and docs/agent/CONTINUITY.md first. The mission is authorised until ${m.deadline}.`,
    `Branch: ${m.branch}. Last checkpoint: ${m.lastCheckpoint?.summary ?? 'none recorded'}.`,
    `Done: ${done.map((r) => r.id).join(', ') || 'none yet'}.`,
    'Still to do:',
    ...actionable.map((r) => `  - ${r.id} ${r.title}`),
  ]
  if (blocked.length > 0) lines.push(`Waiting on Grant (do not stop for these): ${blocked.map((r) => r.id).join(', ')}.`)
  lines.push(`Next action: ${m.nextAction ?? 'choose the next open requirement'}.`)
  lines.push('Record a checkpoint in docs/agent/EXECUTION-STATE.json after each completed unit, and continue.')
  return lines.join('\n')
}
