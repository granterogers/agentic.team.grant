/** Types for the stop decision (gate.mjs). */
import type { Ledger, Mission, Requirement } from './state.d.mts'

export const DEFAULTS: { maxConsecutiveBlocksPerSession: number; maxBlocksPerMission: number }

export function classify(mission: Mission): { actionable: Requirement[]; blocked: Requirement[]; done: Requirement[] }

export function blockReason(mission: Mission, actionable: Requirement[], blocked: Requirement[], deadline: string): string

export interface Decision {
  action: 'allow' | 'block'
  reason: string
  mission: string | null
  nextStatus: string | null
  counts: Record<string, number>
}

export function decide(
  state: Ledger,
  input: { session_id?: string; stop_hook_active?: boolean },
  env: { now: Date; stopRequested: boolean; branch?: string; limits?: Partial<typeof DEFAULTS> },
): Decision

export function applyDecision(
  state: Ledger,
  input: { session_id?: string },
  decision: Decision,
  now: Date,
): Ledger
