/** Types for the execution ledger (state.mjs). The runtime file is the source; this declares its shape for the type checker. */

export const SCHEMA: 1
export const STALE_LOCK_MS: number
export const DEFAULT_STATE_PATH: string
export const DEFAULT_LOCK_PATH: string

export interface Requirement {
  id?: string
  title?: string
  status?: 'todo' | 'in_progress' | 'blocked' | 'done'
  issue?: string
  evidence?: string
}

export interface Mission {
  id?: string
  title?: string
  status?: string
  deadline?: string
  branch?: string
  requirements?: Requirement[]
  nextAction?: string
  endedReason?: string
  lastCheckpoint?: { at?: string; commit?: string | null; summary?: string }
  [key: string]: unknown
}

export interface Session {
  id?: string
  parent?: string | null
  startedAt?: string
  endedAt?: string | null
  lastActivityAt?: string | null
  terminationReason?: string | null
  resumeEligible?: boolean
  [key: string]: unknown
}

export interface Ledger {
  schema: 1
  revision: number
  updatedAt: string
  /** Null only before any mission has been recorded; the tests and the runtime treat a missing mission as "none". */
  mission: Mission
  sessions: Session[]
  stopGate: { blocksTotal: number; lastBlockAt: string | null; blocksBySession: Record<string, number> }
  [key: string]: unknown
}

export class StateConflictError extends Error {
  expected: number
  actual: number
}

export class LockTimeoutError extends Error {}

export interface Lock {
  path: string
  takenOver: { previousPid: number | null; reason: string } | null
}

export function emptyState(now?: Date): Ledger
export function readState(path: string): Ledger
export function writeAtomic(path: string, data: string): void
export function sweepTemporaries(path: string): string[]
export function acquireLock(
  lockPath: string,
  options?: { waitMs?: number; staleMs?: number; now?: () => number },
): Promise<Lock>
export function releaseLock(lock: Lock): void
export function updateState(
  path: string,
  lockPath: string,
  expectedRevision: number | undefined,
  mutate: (state: Ledger) => Ledger,
  options?: { waitMs?: number; staleMs?: number; now?: () => number },
): Promise<{ state: Ledger; takenOver: Lock['takenOver'] }>
