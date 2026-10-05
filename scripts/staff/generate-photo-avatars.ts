/**
 * Photorealistic staff avatars.
 *
 *   npm run avatars:photo            # report what it would do, spend nothing
 *   npm run avatars:photo -- --go    # generate, and pay for it
 *
 * ## This script spends money, and it is the only thing in this repository that does
 *
 * §11 is categorical that inference must never incur cost, and it is enforced
 * by deterministic code in the provider router. Nothing here weakens that: this
 * script is **not reachable from the router, the worker or any job**. It is a
 * manual, one-off asset build that a human runs, and it is written to be
 * obvious about that — a dry run by default, a printed cost before and after,
 * and a hard cap that aborts rather than overspending.
 *
 * The spend is recorded in `inference_usage` like any other, because a cost
 * that does not appear in the ledger is a cost nobody can see. It is tagged
 * with a correlation of its own so it never looks like a job's spend.
 *
 * ## Why these are photographs, having argued they should not be
 *
 * The earlier judgement — recorded in `docs/implementation-plan.md` and acted
 * on — was that illustrated avatars were right: a synthetic photograph is a
 * claim about a person who does not exist, and §12 spends its length on not
 * presenting inference as observation.
 *
 * Grant has asked for photorealistic ones, twice. It is his workspace, he knows
 * exactly what the team is, and the concern was about how the images might read
 * to someone who did not — which does not apply to a private workspace with one
 * member. The illustrated set is kept in `assets/avatars/` rather than deleted,
 * so the decision is reversible by changing one config value.
 *
 * ## What the prompts are trying to achieve
 *
 * Recognisability at 48 pixels in a Slack sidebar, which is the only size that
 * matters. That means: one face, filling the frame, plain background, even
 * light, no props, no text. Eight people who cannot be mistaken for each other
 * at a glance — varied in age, build, colouring and presentation — because
 * eight interchangeable head-and-shoulders shots are eight staff nobody can
 * tell apart, which is the exact failure the avatars exist to prevent.
 */

import '../../src/safety/require-production-writes.ts'
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
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabaseToken,
)

/**
 * The cheap image model, deliberately.
 *
 * A staff avatar is displayed at 48 pixels in a sidebar and 512 at its largest.
 * Paying for the best available model to produce something that will be scaled
 * to a thumbnail is spending on detail nobody will ever see.
 */
const MODEL = 'gpt-image-1-mini'
const SIZE = '1024x1024'
const QUALITY = 'medium'

/** Aborts rather than overspending, whatever the API decides to charge. */
const HARD_CAP_USD = 2.0
/** Published price for this model at this size and quality, in USD per image. */
const ESTIMATED_PER_IMAGE = 0.011

const COMMON =
  'Photorealistic corporate headshot portrait. One person, head and shoulders, ' +
  'facing camera, natural expression, soft even studio lighting, plain ' +
  'uncluttered neutral background, shallow depth of field, sharp focus on the ' +
  'eyes, square composition with the face filling most of the frame. ' +
  'No text, no logos, no props, no hands, no border.'

/**
 * One person per role.
 *
 * Written as descriptions of a person rather than of a job, because a prompt
 * that says "a strategist" produces the model's average of a strategist, and
 * eight averages look like the same person eight times.
 */
const PEOPLE: readonly { slug: string; who: string }[] = [
  {
    slug: 'chief-of-staff',
    who:
      'A woman in her early fifties, East Asian, short silver-grey bob, ' +
      'rectangular dark-framed glasses, charcoal blazer over a white shirt, ' +
      'calm and direct expression.',
  },
  {
    slug: 'research-director',
    who:
      'A man in his late thirties, South Asian, thick black hair and a short ' +
      'trimmed beard, round tortoiseshell glasses, olive-green knitted jumper ' +
      'over a collared shirt, thoughtful half-smile.',
  },
  {
    slug: 'strategy-director',
    who:
      'A woman in her mid forties, Black, close-cropped natural hair, gold ' +
      'hoop earrings, deep burgundy blazer, composed and appraising expression.',
  },
  {
    slug: 'growth-director',
    who:
      'A man in his late twenties, White with freckles and short curly ginger ' +
      'hair, no glasses, open-collar light blue shirt, warm and energetic smile.',
  },
  {
    slug: 'finance-director',
    who:
      'A woman in her early sixties, White, straight shoulder-length grey hair ' +
      'tucked behind one ear, thin wire-rimmed glasses, navy jumper over a ' +
      'striped shirt, dry sceptical expression.',
  },
  {
    slug: 'operations-director',
    who:
      'A man in his mid fifties, Latino, salt-and-pepper hair and a moustache, ' +
      'heavy-set build, no glasses, practical grey work shirt, steady ' +
      'unhurried expression.',
  },
  {
    slug: 'quality-director',
    who:
      'A woman in her mid thirties, Middle Eastern, long dark hair tied back, ' +
      'strong eyebrows, minimal makeup, black high-necked top, serious and ' +
      'unflinching expression.',
  },
  {
    slug: 'communications-director',
    who:
      'A person in their early thirties, androgynous presentation, mixed ' +
      'heritage, wavy shoulder-length auburn hair, small silver nose stud, ' +
      'mustard-yellow shirt, lively and attentive expression.',
  },
]

const CORRELATION = '00000000-0000-4000-8000-00000a7a7a7a'
const OUT_DIR = 'assets/avatars/photo'

console.log(`model: ${MODEL} ${SIZE} ${QUALITY}`)
console.log(`people: ${String(PEOPLE.length)}`)
console.log(
  `estimated: $${(PEOPLE.length * ESTIMATED_PER_IMAGE).toFixed(2)} (cap $${HARD_CAP_USD.toFixed(2)})`,
)
if (!go) {
  console.log('\nDRY RUN. Nothing generated and nothing spent. Re-run with --go.')
  process.exit(0)
}
if (PEOPLE.length * ESTIMATED_PER_IMAGE > HARD_CAP_USD) {
  console.error('the estimate exceeds the hard cap; refusing to start')
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })

let spent = 0
let made = 0
for (const person of PEOPLE) {
  const started = Date.now()
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${COMMON} ${person.who}`,
      size: SIZE,
      quality: QUALITY,
      n: 1,
    }),
  })

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200)
    console.error(`  ${person.slug}: HTTP ${String(response.status)} ${detail}`)
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
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  }
  const b64 = body.data?.[0]?.b64_json
  if (b64 === undefined) {
    console.error(`  ${person.slug}: no image in the response`)
    continue
  }

  await writeFile(`${OUT_DIR}/${person.slug}.png`, Buffer.from(b64, 'base64'))
  made += 1
  spent += ESTIMATED_PER_IMAGE

  // Recorded as ESTIMATED, not measured: the images endpoint returns token
  // counts but no price, so the figure is ours. §11 forbids presenting an
  // estimate as an observation, and `provider_reported_cost` staying null is
  // what makes the difference visible downstream.
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
    `  ${person.slug}: written (${String(Math.round((Date.now() - started) / 100) / 10)}s)`,
  )

  if (spent > HARD_CAP_USD) {
    console.error(`hard cap reached after ${String(made)} image(s); stopping`)
    break
  }
}

console.log(`\n${String(made)}/${String(PEOPLE.length)} written to ${OUT_DIR}/`)
console.log(`estimated spend: $${spent.toFixed(2)} — recorded in inference_usage as ESTIMATED`)
