/*
 * The studio, served the way Vercel serves it.
 *
 * Every browser check in this repository embeds its own `createServer` that
 * 404s anything which is not a file on disk, and they all navigate to `/` and
 * drive the state in-page. That is fine for the default studio and cannot
 * reach a deep address at all — so a check of a real route would be a check of
 * the harness's own fallback rather than of the product.
 *
 * This is one server that applies the REWRITE IN vercel.json rather than
 * paraphrasing it: any dotless path outside api/, studio/, samples/ and
 * fonts/ serves index.html, and everything else is looked up on disk. A check
 * written against this is a check of the addresses Grant will actually open.
 */
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join } from 'node:path'

const ROOT = 'web/studio'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

/**
 * The rewrite from vercel.json, transcribed once.
 *
 * `/:path((?!api/|studio/|samples/|fonts/)[^.]*)` -> `/index.html`. The
 * character class excluding a full stop is what lets a real asset through, and
 * it is also the reason `/basecamp` (no dot) reaches the app while
 * `/bc/bc.css` (a dot) reaches the file.
 */
export const rewrites = (path: string): boolean => {
  const bare = path.replace(/^\//, '')
  if (/^(api|studio|samples|fonts)\//.test(bare)) return false
  return !bare.includes('.')
}

export const serveStudio = async (port: number): Promise<Server> => {
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const wanted = path === '/' || rewrites(path) ? 'index.html' : path.replace(/^\//, '')
    const file = join(ROOT, wanted)
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
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
