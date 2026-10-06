/**
 * The file-owning half of the log query budget (src/safety/log-query-budget.ts): it reads and appends the ledger and wraps one
 * request. EVERY path to the provider's log service in this repository goes through `withLogGuard`: `mgmt` in common.ts (so
 * logs-capture.ts and usage-capture.ts), host-capture.ts and incident-snapshot.ts. A new script that calls `mgmt` gets the guard
 * without knowing it exists, which is the point.
 *
 * The ledger is `.out/forensics/log-query-ledger.jsonl`: append-only, one JSON row per intent and per outcome. The intent row is
 * written BEFORE the request is sent, so a run that dies in flight has still spent. Nothing here sends a request on its own.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import {
  bytesProcessedOf,
  isLogQuery,
  judgeLogQuery,
  type LedgerRow,
  parseLogRequest,
  sqlHash,
} from '../../src/safety/log-query-budget.ts'

export const LEDGER_DIR = '.out/forensics'
export const LEDGER = `${LEDGER_DIR}/log-query-ledger.jsonl`

export class LogQueryRefused extends Error {
  constructor(reason: string) {
    super(`LOG QUERY REFUSED: ${reason}`)
    this.name = 'LogQueryRefused'
  }
}

export const readLedger = (file = LEDGER): LedgerRow[] => {
  if (!existsSync(file)) return []
  const rows: LedgerRow[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      rows.push(JSON.parse(line) as LedgerRow)
    } catch {
      // A torn line is skipped; the rows around it still count.
    }
  }
  return rows
}

const append = (row: LedgerRow, file = LEDGER): void => {
  mkdirSync(LEDGER_DIR, { recursive: true })
  appendFileSync(file, `${JSON.stringify(row)}\n`)
}

let last: { row: LedgerRow; ledger: string } | null = null

export interface Sent {
  status: number
  text: string
}

/**
 * Run one request under the budget. `file` (optional) names the saved raw result so a later question can be answered from it.
 * Throws LogQueryRefused, having sent nothing, when a rule is not met; the message names the rule.
 */
export const withLogGuard = async <T extends Sent>(
  path: string,
  send: () => Promise<T>,
  opts: { ledger?: string; now?: () => Date } = {},
): Promise<T> => {
  if (!isLogQuery(path)) return send()
  const ledgerFile = opts.ledger ?? LEDGER
  const now = (opts.now ?? (() => new Date()))()
  const req = parseLogRequest(path)
  if (req === null) return send()
  const ledger = readLedger(ledgerFile)
  const verdict = judgeLogQuery(req, ledger, process.env, now)
  if (!verdict.ok) throw new LogQueryRefused(verdict.reason)
  for (const n of verdict.notes) console.error(`log query: ${n}`)
  const id = randomUUID()
  const base = {
    id,
    kind: req.kind,
    sqlHash: sqlHash(req.sql),
    windowStart: req.start === null ? null : req.start.toISOString(),
    windowEnd: req.end === null ? null : req.end.toISOString(),
    windowMin: req.windowMin,
    reason: (process.env.LOG_QUERY_REASON ?? '').trim().slice(0, 300),
    ...(verdict.override === undefined ? {} : { override: verdict.override }),
  }
  append({ ...base, at: now.toISOString(), phase: 'intent' }, ledgerFile)
  const r = await send()
  const bytes = bytesProcessedOf(r.text)
  const outcome: LedgerRow = {
    ...base,
    at: new Date().toISOString(),
    phase: 'outcome',
    status: r.status,
    bytesReturned: r.text.length,
    ...(bytes === undefined ? {} : { bytesProcessed: bytes }),
  }
  append(outcome, ledgerFile)
  last = { row: outcome, ledger: ledgerFile }
  return r
}

/**
 * The caller saves the raw result after the request returns, so it tells the ledger where it went. That is what lets the NEXT
 * request for the same question be answered from the file (rule 5). The copy carries no byte count, so nothing is counted twice.
 */
export const attachSavedFile = (file: string): void => {
  if (last === null) return
  const { bytesProcessed: _dropped, ...rest } = last.row
  append({ ...rest, file }, last.ledger)
}
