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
}

export interface SuperviseResult {
  outcome: string
  reason?: string
  prompt?: string
  pid?: number | null
}

export function supervise(options?: SuperviseOptions): Promise<SuperviseResult>
