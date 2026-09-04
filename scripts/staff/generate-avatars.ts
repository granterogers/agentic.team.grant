/**
 * Generate the staff avatars and write them to `assets/avatars/`.
 *
 *   npm run avatars           # write the SVGs and a contact sheet
 *   npm run avatars -- --db   # also set staff.avatar_ref
 *
 * The contact sheet is not decoration. Eight portraits generated from a hash
 * can all be individually fine and collectively useless - two roles landing on
 * the same hair, skin and clothing is invisible in the code and obvious in a
 * row of thumbnails. `collisions()` reports clashes; the sheet is how a human
 * (or a screenshot) sees them together.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { ROLE_SLUGS } from '../../src/agents/router.ts'
import { avatarFor, featuresFor, identityKey } from '../../src/staff/avatar.ts'

const OUT = 'assets/avatars'

const collisions = (): string[] => {
  const seen = new Map<string, string>()
  const out: string[] = []
  for (const slug of ROLE_SLUGS) {
    const key = identityKey(slug)
    const prior = seen.get(key)
    if (prior !== undefined) out.push(`${prior} and ${slug} are indistinguishable (${key})`)
    else seen.set(key, slug)
  }
  return out
}

await mkdir(OUT, { recursive: true })

const clashes = collisions()
for (const c of clashes) console.log(`clash: ${c}`)

const cards: string[] = []
for (const slug of ROLE_SLUGS) {
  const svg = avatarFor(slug)
  await writeFile(`${OUT}/${slug}.svg`, `${svg}\n`, 'utf8')
  const f = featuresFor(slug)
  cards.push(
    `<figure><div class="a">${svg}</div><figcaption>${slug}<br><small>skin ${String(f.skin)} · hair ${String(f.hair)}/${String(f.hairStyle)}${f.glasses ? ' · glasses' : ''}${f.beard ? ' · beard' : ''}</small></figcaption></figure>`,
  )
}

await writeFile(
  `${OUT}/contact-sheet.html`,
  `<!doctype html><meta charset="utf-8"><title>staff avatars</title>
<style>
 body{font:13px system-ui;background:#fff;margin:24px;color:#222}
 .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;max-width:900px}
 figure{margin:0;text-align:center}
 .a svg{width:150px;height:150px;border-radius:50%;display:block;margin:0 auto}
 .row{display:flex;gap:10px;justify-content:center;margin:24px 0}
 .row svg{width:44px;height:44px;border-radius:50%}
 small{color:#777}
</style>
<h2>Staff avatars</h2>
<div class="grid">${cards.join('')}</div>
<h3>At sidebar size - the only size that matters for telling them apart</h3>
<div class="row">${ROLE_SLUGS.map((s) => avatarFor(s)).join('')}</div>
`,
  'utf8',
)

console.log(`wrote ${String(ROLE_SLUGS.length)} avatars to ${OUT}/`)
if (clashes.length > 0)
  console.log(`\n${String(clashes.length)} clash(es) - pin them in AVATAR_OVERRIDES.`)

if (process.argv.includes('--db')) {
  const { ManagementApiExecutor } = await import('../../src/db/executor.ts')
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (token === undefined || token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is required for --db')
    process.exit(2)
  }
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    token,
  )
  // 0018 grants the app role no write on `staff` (§21: role identity is not
  // silently rewritable). This runs as the migration identity, deliberately.
  for (const slug of ROLE_SLUGS) {
    await db.execute(
      `update public.staff set avatar_ref = 'assets/avatars/${slug}.svg' where slug = '${slug}'`,
    )
  }
  const { rows } = await db.execute(
    `select count(*)::int as n from public.staff where avatar_ref is not null`,
  )
  console.log(`avatar_ref set on ${String(rows[0]?.n)} staff row(s)`)
}
