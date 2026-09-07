/**
 * Cartoon staff avatars, matched to the names.
 *
 *   npm run avatars:cartoon             # report what it would do, spend nothing
 *   npm run avatars:cartoon -- --go     # generate, upload, and pay for it
 *
 * ## This script spends money, and it is one of two things here that does
 *
 * §11 is categorical that inference must never incur cost, and the provider
 * router enforces it. Nothing here weakens that: this script is not reachable
 * from the router, the worker or any job. It is a manual asset build — dry run
 * by default, printed cost before and after, hard cap that aborts.
 *
 * ## Why these replace the photographs
 *
 * Grant: *"I changed my mind on the photorealistic. I think everyone would just
 * have more of a cartoony avatar, and make sure the gender of the name matches
 * the photograph."*
 *
 * Which lands where `docs/implementation-plan.md` originally was, and for a
 * reason worth keeping written down: a synthetic photograph is a claim about a
 * person who does not exist. §12 spends its length on not presenting inference
 * as observation, and eight invented faces are the most literal version of that
 * available. An illustration is honest about being an illustration and is
 * MORE recognisable at 48 pixels, not less — a flat drawing with two or three
 * strong colours survives a sidebar thumbnail where a photograph becomes a
 * beige smudge.
 *
 * ## Gender is read from the database, not written here
 *
 * `staff.pronouns` (0079). A prompt that does not say produces the model's
 * average of a director, which is how a team called Grace and Marcus ends up
 * illustrated as two indistinguishable men. Reading it from the row is also
 * what stops the two drifting apart when a name is edited in the front end and
 * this script is re-run months later.
 *
 * ## And they are uploaded, which the photo script never did
 *
 * The earlier set sat in `assets/` for a week while every Slack message fell
 * back to an emoji, because generating an avatar and hosting one are different
 * jobs and only the first had a script. This one does both and reports the URL
 * it verified.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { recordUsage } from '../../src/inference/record.ts'

const apiKey = process.env.OPENAI_API_KEY ?? ''
const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (apiKey === '') {
  console.error('OPENAI_API_KEY is not set')
  process.exit(2)
}
if (supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set — the spend has to be recordable')
  process.exit(2)
}

const go = process.argv.includes('--go')
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabaseToken)

const MODEL = 'gpt-image-1-mini'
const SIZE = '1024x1024'
const QUALITY = 'medium'
const HARD_CAP_USD = 2.0
const ESTIMATED_PER_IMAGE = 0.011
const CORRELATION = '00000000-0000-4000-8000-00000ca27007'
const OUT_DIR = 'assets/avatars/cartoon'
const BUCKET = 'avatars'

/**
 * One house style, so eight drawings read as one team.
 *
 * Flat vector, thick outline, two or three colours: the constraints are all
 * about 48 pixels, which is the only size that matters. Detail below that
 * threshold is detail nobody sees, and gradients and fine linework are what
 * turn a thumbnail into a smudge.
 */
const STYLE =
  'Flat vector cartoon avatar illustration, modern corporate-memphis style. ' +
  'Head and shoulders, facing forward, bold clean outlines, simple geometric ' +
  'shapes, a limited palette of two or three flat colours plus skin tone, ' +
  'solid single-colour background, no gradients, no shading detail, no text, ' +
  'no logos, no props, square composition with the head filling most of the ' +
  'frame. Friendly, competent, unmistakable at thumbnail size.'

/**
 * What makes each of them a different person at a glance.
 *
 * Hair, colour and one strong feature each — not job descriptions. A prompt
 * that says "a strategist" produces the model's average of a strategist, and
 * eight averages look like the same person eight times.
 */
const LOOK: Record<string, string> = {
  'chief-of-staff':
    'short silver-grey bob, rectangular dark glasses, deep teal blazer, calm direct expression',
  'strategy-director':
    'dark brown side-parted hair, no glasses, mustard-yellow jumper, thoughtful raised eyebrow',
  'research-director':
    'long auburn hair tied back, round tortoiseshell glasses, forest-green shirt, curious expression',
  'finance-director':
    'closely cropped grey hair and beard, thin wire glasses, navy shirt, dry sceptical expression',
  'growth-director':
    'shoulder-length black curly hair, gold hoop earrings, coral top, bright energetic smile',
  'operations-director':
    'shaved head, dark full beard, olive work shirt, steady unhurried expression',
  'quality-director':
    'straight dark bob with a blunt fringe, no glasses, plum high-necked top, serious unflinching expression',
  'communications-director':
    'wavy light-brown hair, freckles, open-collar sky-blue shirt, lively attentive expression',
}

const PERSON: Record<string, string> = {
  'she/her': 'a woman',
  'he/him': 'a man',
  'they/them': 'a person, androgynous presentation',
}

const team = (
  await db.execute(`
    select slug, name, title, coalesce(pronouns, 'they/them') as pronouns
      from public.staff
     where active and slug not like 'fixture-%'
     order by slug
  `)
).rows as { slug: string; name: string; title: string; pronouns: string }[]

console.log(`model: ${MODEL} ${SIZE} ${QUALITY}`)
console.log(`people: ${String(team.length)}`)
for (const p of team) {
  console.log(
    `  ${p.name.padEnd(8)} ${p.pronouns.padEnd(10)} ${LOOK[p.slug] === undefined ? '⚠️  no look written' : p.title}`,
  )
}
console.log(
  `estimated: $${(team.length * ESTIMATED_PER_IMAGE).toFixed(2)} (cap $${HARD_CAP_USD.toFixed(2)})`,
)
if (!go) {
  console.log('\nDRY RUN. Nothing generated, nothing uploaded, nothing spent. Re-run with --go.')
  process.exit(0)
}
if (team.length * ESTIMATED_PER_IMAGE > HARD_CAP_USD) {
  console.error('the estimate exceeds the hard cap; refusing to start')
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })

/** Put the file where Slack and the page can read it, and prove it is there. */
async function upload(slug: string, bytes: Buffer): Promise<string | null> {
  if (serviceKey === '') return null
  const path = `${slug}.png`
  const response = await fetch(`https://${ref}.supabase.co/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'image/png',
      // Overwrite rather than fail: this script is re-run whenever a name
      // changes, and a second run that errored on every file would be a script
      // nobody runs twice.
      'x-upsert': 'true',
    },
    body: new Uint8Array(bytes),
  })
  if (!response.ok) {
    console.error(
      `  upload failed: HTTP ${String(response.status)} ${(await response.text()).slice(0, 160)}`,
    )
    return null
  }
  return `https://${ref}.supabase.co/storage/v1/object/public/${BUCKET}/${path}`
}

let spent = 0
let made = 0
const results: { slug: string; url: string | null }[] = []

for (const person of team) {
  const look = LOOK[person.slug]
  if (look === undefined) {
    // Named rather than skipped silently: a new director with no look written
    // would get the model's average and nobody would notice which one it was.
    console.log(`  ${person.name}: no look written for ${person.slug} — skipped`)
    continue
  }
  const who = PERSON[person.pronouns] ?? PERSON['they/them']
  const started = Date.now()

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${STYLE} The subject is ${String(who)} with ${look}.`,
      size: SIZE,
      quality: QUALITY,
      n: 1,
    }),
  })

  if (!response.ok) {
    console.error(
      `  ${person.name}: HTTP ${String(response.status)} ${(await response.text()).slice(0, 160)}`,
    )
    await recordUsage(db, {
      provider: 'openai',
      modelId: MODEL,
      correlationId: CORRELATION,
      outcome: 'provider_error',
      providerReportedCost: null,
    })
    continue
  }

  const body = (await response.json()) as {
    data?: { b64_json?: string }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const b64 = body.data?.[0]?.b64_json
  if (b64 === undefined) {
    console.error(`  ${person.name}: no image in the response`)
    continue
  }

  const bytes = Buffer.from(b64, 'base64')
  await writeFile(`${OUT_DIR}/${person.slug}.png`, bytes)
  const url = await upload(person.slug, bytes)
  results.push({ slug: person.slug, url })
  made += 1
  spent += ESTIMATED_PER_IMAGE

  // ESTIMATED, not measured: the images endpoint returns token counts but no
  // price, so the figure is ours. §11 forbids presenting an estimate as an
  // observation, and a null `provider_reported_cost` is what keeps the
  // difference visible downstream.
  await recordUsage(db, {
    provider: 'openai',
    modelId: MODEL,
    correlationId: CORRELATION,
    outcome: 'ok',
    promptTokens: body.usage?.input_tokens ?? 0,
    completionTokens: body.usage?.output_tokens ?? 0,
    providerReportedCost: null,
  })

  console.log(
    `  ${person.name}: written${url === null ? ' (not uploaded)' : ' and uploaded'} ` +
      `(${String(Math.round((Date.now() - started) / 100) / 10)}s)`,
  )

  if (spent > HARD_CAP_USD) {
    console.error(`hard cap reached after ${String(made)} image(s); stopping`)
    break
  }
}

// Point the roster at the new files, only for the ones that actually uploaded.
// A row naming an image that does not exist is worse than one naming none: the
// emoji fallback is a working avatar, and a broken URL is a broken avatar.
for (const r of results) {
  if (r.url === null) continue
  await db.execute(`update public.staff set avatar_ref = '${r.slug}.png' where slug = '${r.slug}'`)
}

console.log(
  `\n${String(made)}/${String(team.length)} drawn, ${String(results.filter((r) => r.url !== null).length)} uploaded`,
)
console.log(`estimated spend: $${spent.toFixed(2)} — recorded in inference_usage as ESTIMATED`)

// Read one back. An upload that returned 200 and a URL that 404s are different
// things, and the second is what a person sees.
const check = results.find((r) => r.url !== null)
if (check?.url !== undefined && check.url !== null) {
  const probe = await fetch(check.url, { method: 'HEAD' })
  console.log(`served: ${check.url} — HTTP ${String(probe.status)}`)
}
