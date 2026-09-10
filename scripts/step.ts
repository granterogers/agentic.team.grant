/**
 * Say what the build is doing, while it is doing it.
 *
 *   npm run step -- "Drafting the reference board" --towards M0
 *   npm run step -- --finish <id> --produced "docs/design/references.md"
 *   npm run step -- "Portfolio, second pass" --shot .out/portfolio.png --finish-now
 *
 * ## Why
 *
 * Grant: *"I want to see what it is that you're doing ... so that I can pop
 * into the application and see what it is you're doing."*
 *
 * The office reports itself. The build session did not, so the only way to see
 * work in progress was to open a terminal and read scrollback — the exact
 * dependence he has spent weeks trying to reduce.
 *
 * ## Screenshots are most of the value
 *
 * The render→capture→critique loop produces images, and an image is the only
 * honest way to report visual work: "improved the spacing" is worth nothing and
 * a picture of it is worth looking at. `--shot` uploads to the same Storage
 * bucket pattern the staff avatars already use — no new vendor, no new
 * credential, no new cost.
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const BUCKET = 'build'

const args = process.argv.slice(2)
const flag = (name: string): string | null => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? null : (args[at + 1] ?? null)
}
const has = (name: string): boolean => args.includes(`--${name}`)

// Everything that is not a flag or a flag's value is the headline.
const consumed = new Set<number>()
for (const [i, a] of args.entries()) {
  if (!a.startsWith('--')) continue
  consumed.add(i)
  if (!['finish-now', 'blocked'].includes(a.slice(2))) consumed.add(i + 1)
}
const headline = args
  .filter((_, i) => !consumed.has(i))
  .join(' ')
  .trim()

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(REF, supabase)
const lit = (v: string | null): string => (v === null ? 'null' : `'${v.replace(/'/g, "''")}'`)

/**
 * The screenshot, where the page can read it.
 *
 * `x-upsert` because the same step is re-shot as it is iterated, and a script
 * that errored on the second capture would be a script nobody uses twice —
 * the same reasoning as the avatar upload it copies.
 */
async function upload(path: string): Promise<string | null> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (serviceKey === '') {
    console.error('  no SUPABASE_SERVICE_ROLE_KEY — the step is recorded without its picture')
    return null
  }
  const bytes = await readFile(path)
  const name = `${Date.now().toString(36)}-${basename(path)}`
  const response = await fetch(`https://${REF}.supabase.co/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': path.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
      'x-upsert': 'true',
    },
    body: new Uint8Array(bytes),
  })
  if (!response.ok) {
    console.error(`  upload failed: HTTP ${String(response.status)}`)
    return null
  }
  return `https://${REF}.supabase.co/storage/v1/object/public/${BUCKET}/${name}`
}

// --- finishing an earlier step ----------------------------------------------

const finishing = flag('finish')
if (finishing !== null) {
  const shot = flag('shot')
  const url = shot === null ? null : await upload(shot)
  const state = has('blocked') ? 'blocked' : (flag('state') ?? 'done')
  await db.execute(`
    select public.build_step_finish(${lit(finishing)}::uuid, ${lit(state)},
                                    ${lit(flag('produced'))}, ${lit(url)})
  `)
  console.log(`step ${finishing} → ${state}`)
  process.exit(0)
}

// --- a new step ---------------------------------------------------------------

if (headline === '') {
  console.error('usage: npm run step -- "what you are doing" [--towards M0] [--detail "why"]')
  console.error('       npm run step -- --finish <id> [--produced "..."] [--shot path.png]')
  process.exit(2)
}

const shot = flag('shot')
const url = shot === null ? null : await upload(shot)
const state = has('blocked') ? 'blocked' : has('finish-now') ? 'done' : 'doing'

const row = (
  await db.execute(`
    select public.build_step(
      ${lit(flag('session') ?? new Date().toISOString().slice(0, 10))},
      ${lit(headline)},
      ${lit(flag('towards'))},
      ${lit(flag('detail'))},
      ${lit(state)},
      ${lit(flag('produced'))},
      ${lit(url)}
    ) as id
  `)
).rows[0] as { id?: string }

console.log(`${state}: ${headline}`)
console.log(`  id ${String(row.id)}${url === null ? '' : `\n  shot ${url}`}`)
