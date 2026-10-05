/*
 * The MIRROR of the deployed site, served the way the deployment serves it.
 *
 * `serve-studio.ts` serves the working tree. This serves `.out/live`, which
 * `live:mirror` fills by fetching every file back from the deployed host and
 * checking each one against the bytes that were uploaded. Same rewrite, same
 * root redirect, so a browser driven against this is executing the deployed
 * bytes on the deployed addresses.
 *
 * The one thing it is NOT is the deployed URL in a browser: this container's
 * Chromium cannot verify any public certificate (example.com fails the same
 * way), so no amount of CA work reaches https://…vercel.app from here. The
 * distinction is kept in the report rather than blurred.
 */
import '../../src/safety/arm.ts'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join } from 'node:path'
import { rewrites } from './serve-studio.ts'

const ROOT = '.out/live'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

export const serveLive = async (port: number): Promise<Server> => {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    /* The deployment's own redirect, so the bare address behaves as it does there. */
    if (path === '/') {
      res.writeHead(307, { location: '/basecamp/p/legacy-coaching-course' })
      res.end()
      return
    }
    const wanted = rewrites(path) ? 'index.html' : path.replace(/^\//, '')
    try {
      const body = await readFile(join(ROOT, wanted))
      res.writeHead(200, { 'content-type': TYPES[extname(wanted)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    }
  })
  await new Promise<void>((r) => {
    server.listen(port, '127.0.0.1', () => {
      r()
    })
  })
  return server
}
