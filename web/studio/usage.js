/*
  Usage — every service, every quota, and where it is going.

  Grant: *"a dashboard dedicated to usage across the various API keys, third
  party services, you know, everything so I can keep track of how much is being
  used, how much money is being spent if any. And make it a nice, beautiful,
  graphical presentation, not just like raw numbers. Definitely be good to see a
  fraction of what's being spent over a monthly, weekly, daily quota... and if
  it can be broken down into what's being consumed the most."*

  Issue #61.

  ## The numbers are real

  They are the output of `public.usage_overview(30)` (0191–0193), taken on 11
  September 2026, in exactly the shape the RPC returns — so wiring this to the
  live call is a one-line change rather than a rewrite.

  That mattering is not theoretical. Until this morning this page said
  *"Supabase storage is at 82% of the free tier — 412 MB of 500 MB"*. Nobody
  measured it; the real figures are 6.3% and 4%. It was invented to make a mock
  look realistic and it was the most consequential number on the page. A usage
  dashboard is ENTIRELY numbers, so the same shortcut here would be the whole
  feature being a lie.

  ## Provenance is rendered, not just stored

  Three kinds, and the third is why this is on the face of every card:

    measured    we counted it from our own rows
    reported    the provider told us
    estimated   our own count of something the provider does not publish

  The notebook allowance is the live example — 40 units per five hours is our
  guess, because Google exposes no usage API. A briefing already flattened that
  into a bare "35/40 left" once today. On a page of numbers, an unlabelled
  estimate is indistinguishable from a fact.

  ## Why these charts and not others

  §14A forbids a decorative chart, and most of this data is flat zero — a
  sparkline of nothing is the definition of decorative. So there are exactly
  two chart types, each carrying something a number cannot:

    * a RING per service, because a fraction is a shape. "37 MB of 500 MB" and
      "47 MB of 1 GB" are hard to compare as text and instant as two arcs.
    * one AREA chart, of calls per day, which is the only series here that
      varies at all.

  Everything else is a number, because it is a number.
*/

/** From `public.usage_overview(30)` — 11 September 2026. */
const FALLBACK_USAGE = {
  generated_at: '2026-09-11T07:20:00Z',
  window_days: 30,
  target: 'about £0 / month',
  harness_excluded: 57,
  services: [
    {
      key: 'openrouter',
      name: 'Model calls',
      detail: 'OpenRouter, free tier',
      unit: 'usd',
      used: 0,
      limit: null,
      window: 'last 30 days',
      provenance: 'measured',
      note: 'Every call so far has been on a free model.',
      secondary: { calls: 304, tokens: 486210, failed: 11, harness_excluded: 57 },
      day: 0,
      week: 0,
      month: 0,
    },
    {
      key: 'notebooklm',
      name: 'Notebook generations',
      detail: 'Audio, slides, video, mind maps',
      unit: 'units',
      used: 0,
      limit: 40,
      window: 'five hours',
      provenance: 'estimated',
      note: 'Our own count. Google publishes no usage figure for this.',
      secondary: { week_used: 7, week_limit: 300, operations: 7, failed: 0 },
      day: 7,
      week: 7,
      month: 7,
    },
    {
      key: 'tts',
      name: 'Speech',
      detail: 'Google Chirp 3',
      unit: 'characters',
      used: 0,
      limit: 1000000,
      window: 'this month',
      provenance: 'measured',
      note: 'Counted by us — Google exposes no live counter for Chirp 3.',
      secondary: { failed: 0 },
      day: 0,
      week: 0,
      month: 0,
    },
    {
      key: 'supabase_db',
      name: 'Database',
      detail: 'Supabase, free tier',
      unit: 'bytes',
      used: 37260435,
      limit: 524288000,
      of_limit: 7.1,
      window: 'now',
      provenance: 'measured',
      note: null,
      secondary: {
        largest: [
          { table: 'public.documents', human: '3640 kB' },
          { table: 'public.job_state_transitions', human: '3056 kB' },
          { table: 'public.jobs', human: '1496 kB' },
        ],
      },
    },
    {
      key: 'supabase_storage',
      name: 'File storage',
      detail: 'Supabase, free tier',
      unit: 'bytes',
      used: 46778802,
      limit: 1073741824,
      of_limit: 4.4,
      window: 'now',
      provenance: 'measured',
      note: null,
      secondary: { objects: 67 },
    },
    {
      key: 'mcp',
      name: 'Tool calls',
      detail: 'MCP clients',
      unit: 'calls',
      used: 0,
      limit: null,
      window: 'this month',
      provenance: 'measured',
      note: null,
      secondary: { failed: 0 },
    },
  ],
  top_models: [
    { name: 'cohere/north-mini-code:free', provider: 'openrouter', calls: 246, tokens: 391044, cost: 0, failed: 8 },
    { name: 'dots-studio/dots-3-note-preview:free', provider: 'openrouter', calls: 32, tokens: 61890, cost: 0, failed: 2 },
    { name: 'gpt-image-1-mini', provider: 'openai', calls: 24, tokens: 30112, cost: 0, failed: 1 },
    { name: 'inclusionai/ling-3.0-flash-fin:free', provider: 'openrouter', calls: 2, tokens: 3164, cost: 0, failed: 0 },
  ],
  by_day: [
    { day: '2026-09-03', calls: 4, cost: 0 },
    { day: '2026-09-04', calls: 11, cost: 0 },
    { day: '2026-09-05', calls: 26, cost: 0 },
    { day: '2026-09-06', calls: 19, cost: 0 },
    { day: '2026-09-07', calls: 58, cost: 0 },
    { day: '2026-09-08', calls: 41, cost: 0 },
    { day: '2026-09-09', calls: 33, cost: 0 },
    { day: '2026-09-10', calls: 77, cost: 0 },
    { day: '2026-09-11', calls: 35, cost: 0 },
  ],
}

/*
  Units, said the way a person says them.

  `46778802` is not an answer to "how much storage am I using". Bytes become
  MB or GB, big counts get a thousands separator, and money keeps enough
  decimals to show the first fraction of a penny — because the number that
  would change Grant's mind is the first one that is not zero, and rounding it
  to £0.00 hides exactly that.
*/
export function say(value, unit) {
  const n = Number(value ?? 0)
  if (unit === 'bytes') {
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
    if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
    return `${Math.round(n / 1024)} kB`
  }
  if (unit === 'usd') return n === 0 ? '£0.00' : `£${n.toFixed(n < 0.01 ? 5 : 2)}`
  return n.toLocaleString('en-GB')
}

/** Null until it has been read. A card with invented numbers on it is the
    defect this whole file's header is about. */
export let GROWTH = null

/*
  ---------------------------------------------------------------------------
  The real numbers (#68, #61)
  ---------------------------------------------------------------------------

  This file's header promised that wiring this to `usage_overview(30)` would be
  "a one-line change rather than a rewrite", because the mock was written in the
  RPC's exact shape. It was — the two payloads' keys match key for key.

  That mattering is not theoretical, and the header says why: until the morning
  it was written this page claimed Supabase storage was at 82% of the free tier.
  Nobody had measured it; the real figure was 4%. On a page that is ENTIRELY
  numbers, an invented one is the whole feature being a lie — so the fallback
  below is now clearly the fallback, and the page says when it is showing it.
*/

export const USAGE = { ...FALLBACK_USAGE }
export const usageSource = { live: false, why: 'not asked yet' }

export async function hydrateUsage(read) {
  /*
    Asked separately and allowed to fail on its own (#204).

    Not folded into the same try: a growth reading that is missing should cost
    the growth card and nothing else, and putting it inside would have made an
    unrelated failure blank the whole Usage page — which is the shape of #119,
    where one slow fetch in a Promise.all left the page on its default state
    saying everything was fine.
  */
  void read('conversation_growth')
    .then((g) => {
      if (g !== null && typeof g === 'object' && Array.isArray(g.surfaces)) GROWTH = g
    })
    .catch(() => {
      GROWTH = null
    })

  try {
    const d = await read('usage_overview')
    if (!d || !Array.isArray(d.services)) throw new Error('unexpected shape')
    for (const k of Object.keys(USAGE)) delete USAGE[k]
    Object.assign(USAGE, d)
    usageSource.live = true
    usageSource.why = ''
    return true
  } catch (e) {
    for (const k of Object.keys(USAGE)) delete USAGE[k]
    Object.assign(USAGE, FALLBACK_USAGE)
    usageSource.live = false
    usageSource.why = e instanceof Error ? e.message : String(e)
    return false
  }
}
