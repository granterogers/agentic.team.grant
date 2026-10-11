/**
 * Shared helpers for the Hermes M0 validation harness (docs/hermes/IMPLEMENTATION-TASKS.md, M0).
 *
 * Everything here is LOCAL: no production host is contacted, no office secret is read. Each runner owns the lifecycle of
 * every process it starts and stops them before it exits, so nothing is left running in the background.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, mkdirSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'

export type Environment = 'mock' | 'local' | 'live'
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED'

/** One line of the validation matrix. Evidence names the log or test that reproduces it. */
export interface Check {
  readonly id: string
  readonly name: string
  readonly verdict: Verdict
  readonly environment: Environment
  readonly evidence: string
}

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex')

/** A throwaway credential for this run only. Never printed, never written to a file. */
export const throwaway = (prefix: string): string => `${prefix}_${randomBytes(24).toString('hex')}`

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const waitFor = async (
  label: string,
  probe: () => Promise<boolean>,
  timeoutMs = 30_000,
  everyMs = 250,
): Promise<void> => {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      if (await probe()) return
    } catch {
      /* not up yet */
    }
    await sleep(everyMs)
  }
  throw new Error(`timed out waiting for ${label}`)
}

export const readBody = (req: IncomingMessage, limit = 1_000_000): Promise<string> =>
  new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

export const listen = (server: Server, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr !== null ? addr.port : port)
    })
  })

export const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })

export const newServer = (
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Server =>
  createServer((req, res) => {
    handler(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: String((error as Error).message) })
      else res.end()
    })
  })

export interface Child {
  readonly proc: ChildProcess
  readonly logFile: string
  stop: () => Promise<void>
}

/** Start a child process with stdout and stderr appended to a log file. The caller must stop it. */
export const start = (
  command: string,
  args: readonly string[],
  options: { env: Record<string, string>; cwd: string; logFile: string },
): Child => {
  mkdirSync(dirname(options.logFile), { recursive: true })
  const log = createWriteStream(options.logFile, { flags: 'a' })
  const proc = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout?.pipe(log, { end: false })
  proc.stderr?.pipe(log, { end: false })
  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    proc.kill('SIGTERM')
    const exited = new Promise<void>((r) => proc.once('exit', () => r()))
    await Promise.race([exited, sleep(5000)])
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGKILL')
      await Promise.race([exited, sleep(2000)])
    }
    log.end()
  }
  return { proc, logFile: options.logFile, stop }
}

/** Remove anything credential-shaped before a line goes to a log or a report. */
export const scrub = (s: string): string =>
  s
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]')
    .replace(/\bsk-(or-v1-)?[A-Za-z0-9_-]{16,}/g, 'sk-[redacted]')
    // The harness's own throwaway credentials: a prefix, an underscore, 24 or more hex characters.
    .replace(/\b(mcp|hq|eng|apikey)_[a-f0-9]{24,}\b/g, '$1_[redacted]')

export const matrix = (checks: readonly Check[]): string =>
  [
    '| Id | Check | Verdict | Environment | Evidence |',
    '|---|---|---|---|---|',
    ...checks.map(
      (c) => `| ${c.id} | ${c.name} | **${c.verdict}** | ${c.environment} | ${c.evidence} |`,
    ),
  ].join('\n')
