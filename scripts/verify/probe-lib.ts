/**
 * Shared helpers for the browser probes in this folder.
 *
 * serve() starts a local static server for web/studio (the page is never sent anywhere).
 * touchDrag() performs a real touch gesture through the DevTools protocol, not synthetic events.
 */
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join } from 'node:path'
import type { Page } from 'playwright'

const ROOT = join(process.cwd(), 'web', 'studio')
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

/** Serve web/studio on a free local port. A missing asset is a 404; only a page route falls back to the page. */
export const serve = async (): Promise<{ port: number; close: () => void }> => {
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    let path = decodeURIComponent(url.pathname)
    if (path.endsWith('/')) path += 'index.html'
    try {
      const body = await readFile(join(ROOT, path))
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      if (extname(path) !== '' && extname(path) !== '.html') {
        res.writeHead(404)
        res.end()
        return
      }
      const body = await readFile(join(ROOT, 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(body)
    }
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { port, close: () => server.close() }
}

/** A real touch drag from `from` by (dx, dy), in CSS pixels, through Input.dispatchTouchEvent. */
export const touchDrag = async (
  page: Page,
  from: [number, number],
  dx: number,
  dy: number,
  steps = 8,
): Promise<void> => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from[0], y: from[1] }],
  })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from[0] + (dx * i) / steps, y: from[1] + (dy * i) / steps }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
