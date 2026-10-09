/**
 * Load a REAL edge-function entrypoint the way the platform runs it, so a test can drive its behaviour.
 *
 * Two of the functions (`telegram-webhook`, `slack-events`) import sibling files that the deploy script copies in
 * from `src/` (`./telegram.ts`, `./signature.ts`, ...). Those siblings do not exist beside the entrypoint in the
 * repository, so the entrypoint cannot be imported where it lives. This assembles the same bundle the deploy
 * uploads, in a fresh temporary directory, stubs `Deno`, and imports it. A fresh directory per call also means a fresh
 * module, so a test can load the function again with a different environment (a missing secret, for instance), which a
 * module-level `Deno.env.get` would otherwise freeze.
 *
 * The entrypoint, its siblings and the file map are the deploy's own (scripts/deploy/edge-function.ts and
 * slack-events.ts), so what is tested is what ships. Nothing here reaches a network: `fetch` is the caller's.
 */
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { vi } from 'vitest'

export type EdgeHandler = (request: Request) => Promise<Response>

export interface EdgeBundle {
  /** Entrypoint path relative to the repository root. */
  readonly entry: string
  /** `name beside the entrypoint` -> `source file relative to the repository root`, as the deploy copies them. */
  readonly siblings: Readonly<Record<string, string>>
}

export const TELEGRAM_BUNDLE: EdgeBundle = {
  entry: 'supabase/functions/telegram-webhook/index.ts',
  siblings: { 'telegram.ts': 'src/channels/telegram.ts' },
}

export const SLACK_BUNDLE: EdgeBundle = {
  entry: 'supabase/functions/slack-events/index.ts',
  siblings: {
    'events.ts': 'src/slack/events.ts',
    'interactions.ts': 'src/slack/interactions.ts',
    'signature.ts': 'src/slack/signature.ts',
  },
}

const root = resolve(__dirname, '../..')

export const loadEdge = async (
  bundle: EdgeBundle,
  env: Readonly<Record<string, string>>,
  fetchStub: typeof fetch,
): Promise<EdgeHandler> => {
  const dir = mkdtempSync(join(tmpdir(), 'edge-bundle-'))
  copyFileSync(join(root, bundle.entry), join(dir, 'index.ts'))
  for (const [name, from] of Object.entries(bundle.siblings)) {
    copyFileSync(join(root, from), join(dir, name))
  }
  // A package.json beside the copy keeps Vite from reading the repository's own config for these files.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
  let handler: EdgeHandler | undefined
  vi.stubGlobal('Deno', {
    env: { get: (k: string): string | undefined => env[k] },
    serve: (h: EdgeHandler) => {
      handler = h
    },
  })
  vi.stubGlobal('fetch', fetchStub)
  await import(/* @vite-ignore */ pathToFileURL(join(dir, 'index.ts')).href)
  if (handler === undefined) throw new Error(`${bundle.entry} never called Deno.serve`)
  return handler
}
