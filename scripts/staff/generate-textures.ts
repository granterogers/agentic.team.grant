/**
 * Real material textures, generated once.
 *
 *   npm run textures            # report what it would do, spend nothing
 *   npm run textures -- --go    # generate, and pay for it
 *
 * Issue #206. Grant, twice:
 *
 *     "Still using the same shitty old textures. I told you to forget the SVG
 *      and to AI generate some really beautiful textures, like stone or wood
 *      or whatever ... not just for the background, for the buttons, for
 *      everything. Subtle, but beautiful."
 *
 * ## What was wrong with what it replaces
 *
 * `skins.css` drew five textures with `feTurbulence`, and its own header
 * explained the choice: no requests, no assets. That reasoning produced the
 * problem. **Perlin noise is not a material.** It has no structure — no grain
 * direction, no fracture, no fibre, no tool marks — so `stone` and `plaster`
 * were the same function with different numbers, and neither looked like
 * anything.
 *
 * ## This script spends money, and it is the second thing here that does
 *
 * Everything about the guardrails is copied from `generate-photo-avatars.ts`
 * deliberately, because they are the right ones: dry by default, a printed
 * estimate, a hard cap that aborts rather than overspending, spend recorded in
 * `inference_usage` under its own correlation, and **not reachable from the
 * router, the worker or any job**. §11 says inference must never incur cost;
 * this is the documented exception, not a hole in it.
 *
 * The output is committed, so it is generated once and never paid for twice.
 *
 * ## Greyscale, and why the model is asked for it
 *
 * These are OVERLAYS on a coloured ground at 5–18% opacity. Colour in the
 * texture fights the palette — a warm oak over the cool dark scheme is a
 * brown film — and it doubles the bytes for something no one will see. The
 * prompt asks for greyscale and the post-process enforces it.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { recordUsage } from '../../src/inference/record.ts'

const apiKey = process.env.OPENAI_API_KEY
const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (apiKey === undefined || apiKey === '') {
  console.error('OPENAI_API_KEY is not set')
  process.exit(2)
}
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set — the spend has to be recordable')
  process.exit(2)
}

const go = process.argv.includes('--go')
/*
  `--only a,b,c` generates just those materials.

  Added when the list grew from six to eleven: without it, adding one material
  means paying for all of them again. Small money, but a script that cannot be
  extended without a full re-spend is a script people avoid extending.
*/
const onlyAt = process.argv.indexOf('--only')
const ONLY =
  onlyAt === -1
    ? null
    : new Set((process.argv[onlyAt + 1] ?? '').split(',').filter((x) => x !== ''))
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabaseToken,
)

const MODEL = 'gpt-image-1-mini'
const SIZE = '1024x1024'
const QUALITY = 'medium'
const HARD_CAP_USD = 2.0
const ESTIMATED_PER_IMAGE = 0.011
/** Its own correlation, so this never looks like a job's spend. */
const CORRELATION = '00000000-0000-4000-8000-00000a7e5709'
const OUT_DIR = 'web/studio/textures'

/*
  Shared instruction. Every word of it is load-bearing.

  "flat lighting, no shadows" — a texture with a light direction baked in
  fights the page's own shadows and reads as a photograph pasted behind the UI.

  "no objects, no edges, fills the frame" — the model's instinct is to compose,
  and a composition cannot tile. What is wanted is an infinite field of
  material, cropped arbitrarily.

  "photographed straight on" — any perspective makes the far side of a tile a
  different scale from the near side, which no amount of blending will hide.
*/
const COMMON =
  'A seamless, evenly lit, greyscale macro photograph of a material surface, ' +
  'photographed straight on from directly above, filling the entire frame. ' +
  'Flat diffuse lighting with no shadows, no highlights, no vignette, no ' +
  'light direction. No objects, no edges, no borders, no text, no composition ' +
  'or focal point — an infinite field of the material itself, uniformly in ' +
  'focus corner to corner. Subtle, natural, high detail.'

/**
 * The materials, and why each one is here.
 *
 * Chosen for what survives being tiny, low-opacity and greyscale — which is
 * the real constraint, because these are overlays and not pictures. Marble was
 * considered and rejected: its veining is a COMPOSITION, and cropped to a
 * button it is a random smear. Leather too — beautiful, and at 8% grey it is
 * indistinguishable from plaster, so it is bytes for nothing.
 */
const MATERIALS = [
  {
    id: 'plaster',
    name: 'Plaster',
    note: 'Lime-washed, trowelled',
    prompt:
      'Venetian lime plaster wall, polished stucco, soft cloudy tonal variation ' +
      'with faint trowel sweeps and micro pinholes.',
  },
  {
    id: 'paper',
    name: 'Paper',
    note: 'Cold-press, toothed',
    prompt:
      'Cold-press watercolour paper, pronounced irregular tooth, visible cotton ' +
      'fibres, handmade deckle surface.',
  },
  {
    id: 'travertine',
    name: 'Travertine',
    note: 'Stone, softly pitted',
    prompt:
      'Honed travertine stone slab, natural linear pitting and fine banding, ' +
      'porous limestone surface.',
  },
  {
    id: 'oak',
    name: 'Oak',
    note: 'Quarter-sawn grain',
    prompt:
      'Quarter-sawn white oak, straight tight grain with medullary ray flecks, ' +
      'unfinished sanded timber.',
  },
  {
    id: 'linen',
    name: 'Linen',
    note: 'Woven, slubbed',
    prompt:
      'Belgian linen fabric weave, visible slub and irregular thread thickness, ' +
      'natural woven textile close up.',
  },
  {
    id: 'concrete',
    name: 'Concrete',
    note: 'Board-formed, fine',
    prompt:
      'Board-formed architectural concrete, faint timber shuttering grain and ' +
      'fine aggregate speckle, smooth cast surface.',
  },
  /*
    The stone family, added after Grant looked at the first six: "I'd like some
    extra textures to choose from. Stone is a good one."

    NOT named `slate`, though riven slate was the obvious candidate. `slate` is
    already one of the five PALETTES, and a texture sharing a name with a
    palette is the collision CLAUDE.md records twice — `.stage` meaning two
    things, `.kind.doc` colliding with `.doc`. Basalt is the same riven,
    cleaved, dark stone under a name nothing else has taken.
  */
  {
    id: 'granite',
    name: 'Granite',
    note: 'Crystalline, even speckle',
    prompt:
      'Honed grey granite, fine even crystalline speckle of quartz and feldspar, ' +
      'flat cut stone surface.',
  },
  {
    id: 'basalt',
    name: 'Basalt',
    note: 'Riven, cleaved',
    prompt:
      'Riven basalt stone, cleaved layered surface with fine vesicular pitting ' +
      'and shallow flaking, dark volcanic rock.',
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    note: 'Fine even grain',
    prompt:
      'Sawn sandstone block, fine uniform sedimentary grain with faint bedding ' +
      'lines, matte quarried surface.',
  },
  {
    id: 'terrazzo',
    name: 'Terrazzo',
    note: 'Chips in matrix',
    prompt:
      'Polished terrazzo floor, small irregular stone chips suspended in a ' +
      'smooth cement matrix, evenly scattered.',
  },
  {
    id: 'steel',
    name: 'Steel',
    note: 'Brushed, directional',
    prompt:
      'Brushed stainless steel sheet, fine straight parallel abrasion lines, ' +
      'uniform satin metal finish.',
  },
] as const

const WANTED = MATERIALS.filter((m) => ONLY === null || ONLY.has(m.id))

console.log(`model: ${MODEL} ${SIZE} ${QUALITY}`)
console.log(`materials: ${String(WANTED.length)} of ${String(MATERIALS.length)}`)
for (const m of WANTED) console.log(`  ${m.id.padEnd(11)} ${m.note}`)
console.log(
  `estimated: $${(WANTED.length * ESTIMATED_PER_IMAGE).toFixed(2)} (cap $${HARD_CAP_USD.toFixed(2)})`,
)
if (!go) {
  console.log('\nDRY RUN. Nothing generated and nothing spent. Re-run with --go.')
  console.log('Then: python3 scripts/staff/tile-textures.py   to make them tile and compress.')
  process.exit(0)
}
if (WANTED.length * ESTIMATED_PER_IMAGE > HARD_CAP_USD) {
  console.error('the estimate exceeds the hard cap; refusing to start')
  process.exit(1)
}

await mkdir(`${OUT_DIR}/raw`, { recursive: true })

let spent = 0
let made = 0
for (const m of WANTED) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${COMMON} ${m.prompt}`,
      size: SIZE,
      quality: QUALITY,
      n: 1,
    }),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200)
    console.error(`  ${m.id}: HTTP ${String(response.status)} ${detail}`)
    await recordUsage(db, {
      provider: 'openai',
      modelId: MODEL,
      correlationId: CORRELATION,
      outcome: 'provider_error',
      providerReportedCost: null,
    })
    continue
  }

  const body = (await response.json()) as { data?: { b64_json?: string }[] }
  const b64 = body.data?.[0]?.b64_json
  if (b64 === undefined) {
    console.error(`  ${m.id}: no image in the response`)
    continue
  }

  await writeFile(`${OUT_DIR}/raw/${m.id}.png`, Buffer.from(b64, 'base64'))
  made += 1
  spent += ESTIMATED_PER_IMAGE
  console.log(`  ${m.id}: written`)

  /*
    Recorded as ESTIMATED, not measured: the images endpoint returns token
    counts but no price, so the figure is ours. §11 forbids presenting an
    estimate as an observation, and `provider_reported_cost` staying null is
    how that is said in the ledger.
  */
  await recordUsage(db, {
    provider: 'openai',
    modelId: MODEL,
    correlationId: CORRELATION,
    outcome: 'ok',
    providerReportedCost: null,
  })
}

console.log(`\n${String(made)} written, about $${spent.toFixed(2)} spent`)
console.log('Next: python3 scripts/staff/tile-textures.py')
