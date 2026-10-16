/**
 * The stop decision. Pure: it reads the ledger and the clock and returns what should happen, and touches nothing.
 * scripts/agent/stop-gate.mjs is the process that applies the decision to a real session.
 *
 * The rules, in the order they are checked. The first rule that applies decides:
 *   1. No mission, or the mission is not active: allow. A repository with no mission is not held open.
 *   2. The owner has cancelled (a STOP file exists): allow, and record the mission as cancelled.
 *   3. The authorised deadline has passed: allow, and record the mission as expired.
 *   4. Nothing actionable remains. Every requirement is done, or the only ones left are blocked on an owner: allow, and
 *      record the mission as complete or blocked. A blocked requirement is not a reason to stop the other work.
 *   5. The session has already been held open this many times in a row: allow. This is the loop guard. It is not a
 *      verdict that the work is finished; the ledger keeps the mission active so the next session resumes it.
 *   6. The mission has used its whole block budget: allow, and record the mission as paused.
 *   7. Otherwise: block, and tell the model what remains and what to do next.
 *
 * Allowing is the safe default for every failure of the gate itself (a missing file, a lock timeout, a bad input). A
 * stop gate that traps a session is worse than one that lets it end, because the ledger still says what to resume.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */

export const DEFAULTS = {
  maxConsecutiveBlocksPerSession: 25,
  maxBlocksPerMission: 500,
}

const OPEN = new Set(['todo', 'in_progress'])

/** The requirements a session can still act on, and the ones waiting on a person. */
export function classify(mission) {
  const reqs = Array.isArray(mission.requirements) ? mission.requirements : []
  return {
    actionable: reqs.filter((r) => OPEN.has(r.status)),
    blocked: reqs.filter((r) => r.status === 'blocked'),
    done: reqs.filter((r) => r.status === 'done'),
  }
}

/** The text a model reads when it is held open. It names the work, not the feelings about it. */
export function blockReason(mission, actionable, blocked, deadline) {
  const lines = [
    `Mission ${mission.id} is active until ${deadline}. Requirements still to do:`,
    ...actionable.map((r) => `  - ${r.id} ${r.title}${r.issue ? ` (${r.issue})` : ''}`),
  ]
  if (blocked.length > 0) {
    lines.push('Waiting on the owner (do not stop for these; carry on with the list above):')
    lines.push(...blocked.map((r) => `  - ${r.id} ${r.title}`))
  }
  lines.push(`Next action: ${mission.nextAction ?? 'choose the next open requirement and do it'}`)
  lines.push(
    'Record a checkpoint in docs/agent/EXECUTION-STATE.json after each completed unit. A checkpoint is not an end: continue.',
    'To end the run, the owner creates the STOP file named in docs/agent/CONTINUITY.md.',
  )
  return lines.join('\n')
}

/**
 * @param {object} state the ledger as read
 * @param {object} input the hook input: session_id and stop_hook_active
 * @param {{ now: Date, stopRequested: boolean, branch?: string, limits?: object }} env
 * @returns {{ action: 'allow'|'block', reason: string, mission: string|null, nextStatus: string|null, counts: object }}
 */
export function decide(state, input, env) {
  const limits = { ...DEFAULTS, ...(env.limits ?? {}) }
  const mission = state.mission
  const sessionId = input.session_id ?? 'unknown'
  const none = { mission: mission?.id ?? null, nextStatus: null, counts: {} }

  if (!mission || mission.status !== 'active') {
    return { action: 'allow', reason: 'no active mission', ...none }
  }
  // A mission belongs to the branch it was written on. The ledger is committed, so after a merge every other branch
  // would find it; a session there must not be held open for work it was never given.
  if (typeof env.branch === 'string' && mission.branch && env.branch !== mission.branch) {
    return { action: 'allow', reason: `mission belongs to branch ${mission.branch}, this is ${env.branch}`, ...none }
  }
  if (env.stopRequested) {
    return { action: 'allow', reason: 'owner cancelled the run (STOP file)', ...none, nextStatus: 'cancelled' }
  }
  const deadlineMs = Date.parse(mission.deadline)
  if (!Number.isFinite(deadlineMs)) {
    return { action: 'allow', reason: 'mission has no valid deadline; not holding the session open', ...none, nextStatus: 'paused' }
  }
  if (env.now.getTime() >= deadlineMs) {
    return { action: 'allow', reason: 'authorised deadline reached', ...none, nextStatus: 'expired' }
  }
  const { actionable, blocked } = classify(mission)
  if (actionable.length === 0) {
    const status = blocked.length > 0 ? 'blocked' : 'complete'
    return { action: 'allow', reason: `nothing actionable remains (${status})`, ...none, nextStatus: status }
  }
  const sessionBlocks = state.stopGate?.blocksBySession?.[sessionId] ?? 0
  if (input.stop_hook_active === true && sessionBlocks >= limits.maxConsecutiveBlocksPerSession) {
    return { action: 'allow', reason: `loop guard: held ${sessionBlocks} times in this session`, ...none }
  }
  const missionBlocks = state.stopGate?.blocksTotal ?? 0
  if (missionBlocks >= limits.maxBlocksPerMission) {
    return { action: 'allow', reason: 'block budget for this mission is spent', ...none, nextStatus: 'paused' }
  }
  return {
    action: 'block',
    reason: blockReason(mission, actionable, blocked, mission.deadline),
    ...none,
    counts: { actionable: actionable.length, blocked: blocked.length },
  }
}

/** The change to the ledger that records a decision. Pure, so the gate and its tests apply the same rule. */
export function applyDecision(state, input, decision, now) {
  const next = structuredClone(state)
  const sessionId = input.session_id ?? 'unknown'
  if (decision.action === 'block') {
    next.stopGate = next.stopGate ?? { blocksTotal: 0, lastBlockAt: null, blocksBySession: {} }
    next.stopGate.blocksTotal += 1
    next.stopGate.lastBlockAt = now.toISOString()
    next.stopGate.blocksBySession = { ...next.stopGate.blocksBySession, [sessionId]: (next.stopGate.blocksBySession?.[sessionId] ?? 0) + 1 }
  }
  if (decision.nextStatus && next.mission) {
    next.mission.status = decision.nextStatus
    next.mission.endedReason = decision.reason
  }
  return next
}
