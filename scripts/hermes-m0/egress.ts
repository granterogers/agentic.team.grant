/**
 * An egress recorder: a forward proxy that REFUSES everything and writes down where each request was headed.
 *
 * Hermes is started with this as its HTTP(S) proxy and with loopback excluded (NO_PROXY), so anything it tries to reach on the
 * internet on its own (telemetry, update checks, model catalogue fetches, a tool reaching out) arrives here and is recorded as a host.
 * What this can see: connections made through the standard proxy environment variables by Python's requests/httpx/aiohttp.
 * What it cannot see: a library that ignores them. The check is evidence about Hermes's default behaviour, not a sandbox.
 */
import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { listen } from './lib.ts'

export interface Egress {
  readonly url: string
  /** Every distinct host:port a client tried to reach through the proxy. */
  readonly attempts: Set<string>
  stop: () => Promise<void>
}

export const startEgress = async (): Promise<Egress> => {
  const attempts = new Set<string>()
  const sockets = new Set<Socket>()
  const server: Server = createServer((req, res) => {
    // A plain-HTTP request: the absolute URL names the target.
    try {
      const target = new URL(req.url ?? '')
      attempts.add(`${target.hostname}:${target.port || '80'}`)
    } catch {
      attempts.add(`(unparseable) ${String(req.url)}`)
    }
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('refused by the egress recorder')
  })
  server.on('connect', (req, clientSocket: Socket) => {
    attempts.add(String(req.url))
    sockets.add(clientSocket)
    clientSocket.on('close', () => sockets.delete(clientSocket))
    clientSocket.on('error', () => undefined)
    clientSocket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n')
  })
  const port = await listen(server, 0)
  return {
    url: `http://127.0.0.1:${String(port)}`,
    attempts,
    stop: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** The environment that sends a Python HTTP client through the recorder and keeps loopback direct. */
export const egressEnv = (proxyUrl: string): Record<string, string> => ({
  HTTP_PROXY: proxyUrl,
  HTTPS_PROXY: proxyUrl,
  ALL_PROXY: proxyUrl,
  http_proxy: proxyUrl,
  https_proxy: proxyUrl,
  all_proxy: proxyUrl,
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
})
