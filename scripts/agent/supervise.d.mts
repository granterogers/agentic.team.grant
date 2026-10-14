/** Types for the supervisor (supervise.mjs). */
import type { Ledger } from './lib/state.d.mts'

export const POLICY: {
  maxRestarts: number
  maxSessions: number
  baseBackoffMs: number
  maxBackoffMs: number
  crashWindowMs: number
  crashLimit: number
}

export function splitCommand(command: string): string[]
export function backoffMs(failures: number, policy?: typeof POLICY): number
export function statusFor(reason: string): string | undefined
export function stopReason(
  state: Ledger,
  input: {
    now: Date
    restarts: number
    sessionsStarted: number
    recentFailures: number
    stopRequested: boolean
    branch?: string
    policy?: typeof POLICY
  },
): string | null

export interface SuperviseOptions {
  root?: string
  launch?: boolean
  launcher?: string
  policy?: Partial<typeof POLICY>
  clock?: () => Date
  log?: (line: string) => void
  branch?: string
  expectMission?: string | null
  budget?: { totalUsd: number; perSessionUsd: number } | null
  maxWallClockMs?: number | null
  captureDir?: string | null
  sessionIds?: boolean
  sessionInstructions?: string[]
  readFirst?: string[]
  pollMs?: number
  killGraceMs?: number
}

export interface SuperviseResult {
  outcome: string
  reason?: string
  prompt?: string
  pid?: number | null
  sessionsStarted?: number
  spentUsd?: number
}

export function supervise(options?: SuperviseOptions): Promise<SuperviseResult>

export function gitBranch(root: string): string | undefined
export function costFromResult(
  text: string,
): { costUsd: number | null; claudeSessionId: string | null; subtype: string | null; isError: boolean } | null
export function abortFor(
  state: Ledger | null,
  input: { now: Date; stopRequested: boolean; startedAt: number; maxWallClockMs: number | null },
): { reason: string; status: string } | null
