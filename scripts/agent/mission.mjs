#!/usr/bin/env node
/**
 * The owner's controls for a mission. Run from the repository root.
 *
 *   node scripts/agent/mission.mjs status        what the mission is, what is done, what remains, the last sessions
 *   node scripts/agent/mission.mjs stop          create docs/agent/STOP: the next stop ends the run, and no new session starts
 *   node scripts/agent/mission.mjs resume        set a paused, blocked, cancelled or expired mission back to active
 *
 * Resume is refused while the STOP file exists (remove it first, deliberately), and when the deadline has passed (the
 * owner must authorise a new deadline in the mission record, not by resuming the old one).
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { classify } from './lib/gate.mjs'
import { DEFAULT_LOCK_PATH, DEFAULT_STATE_PATH, readState, updateState } from './lib/state.mjs'

const RESUMABLE = new Set(['paused', 'blocked', 'cancelled', 'expired'])

/** Run one command against a checkout. Returns the lines it prints and the exit code, so tests can call it directly. */
export async function run(argv, { root = process.cwd(), now = () => new Date() } = {}) {
  const [command] = argv
  const statePath = join(root, DEFAULT_STATE_PATH)
  const lockPath = join(root, DEFAULT_LOCK_PATH)
  const stopPath = join(root, 'docs/agent/STOP')
  const out = []
  const say = (line) => out.push(line)

  if (command === 'status') {
    const state = readState(statePath)
    const m = state.mission
    if (!m) {
      say('No mission is recorded.')
      return { code: 0, out }
    }
    const { actionable, blocked, done } = classify(m)
    say(`${m.id}: ${m.title}`)
    say(`status ${m.status}; branch ${m.branch}; deadline ${m.deadline}`)
    say(`revision ${state.revision}; blocks held so far ${state.stopGate?.blocksTotal ?? 0}`)
    say(`STOP file: ${existsSync(stopPath) ? 'PRESENT (the run ends at the next stop)' : 'absent'}`)
    say(`done ${done.length}; still to do ${actionable.length}; waiting on owner ${blocked.length}`)
    for (const r of [...actionable, ...blocked]) say(`  ${r.status.padEnd(11)} ${r.id} ${r.title}${r.issue ? ` (${r.issue})` : ''}`)
    say(`next action: ${m.nextAction ?? 'none recorded'}`)
    for (const s of state.sessions.slice(-3)) {
      say(`session ${s.id ?? '?'} started ${s.startedAt ?? '?'} ended ${s.endedAt ?? 'still running or lost'} (${s.terminationReason ?? 'no reason recorded'})`)
    }
    return { code: 0, out }
  }

  if (command === 'stop') {
    if (existsSync(stopPath)) {
      say(`already stopped: ${stopPath} exists.`)
      return { code: 0, out }
    }
    writeFileSync(stopPath, `Stopped by the owner at ${now().toISOString()}. Remove this file to allow a new run.\n`)
    say(`created ${stopPath}. The next stop ends the run; no new session will start.`)
    return { code: 0, out }
  }

  if (command === 'resume') {
    if (existsSync(stopPath)) {
      say(`refused: ${stopPath} exists. Remove it first, then run resume again.`)
      return { code: 2, out }
    }
    const state = readState(statePath)
    const m = state.mission
    if (!m) {
      say('refused: no mission is recorded.')
      return { code: 2, out }
    }
    if (!RESUMABLE.has(m.status)) {
      say(`refused: the mission is ${m.status}, which is not resumable. A complete mission is finished.`)
      return { code: 2, out }
    }
    if (now().getTime() >= Date.parse(m.deadline)) {
      say(`refused: the deadline ${m.deadline} has passed. Record a new authorised deadline in the mission record first.`)
      return { code: 2, out }
    }
    await updateState(statePath, lockPath, undefined, (s) => {
      s.mission.status = 'active'
      s.mission.endedReason = null
      return s
    })
    say(`mission ${m.id} is active again until ${m.deadline}.`)
    return { code: 0, out }
  }

  say('usage: mission.mjs status | stop | resume')
  return { code: 2, out }
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
if (isEntry) {
  run(process.argv.slice(2), { root: process.cwd() }).then(({ code, out }) => {
    for (const line of out) process.stdout.write(`${line}\n`)
    process.exitCode = code
  })
}
