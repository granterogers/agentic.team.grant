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

const esc = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

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

/** The share of a ceiling, or null when the service has no meaningful one. */
const share = (s) => {
  if (s.of_limit !== undefined && s.of_limit !== null) return Number(s.of_limit)
  if (s.limit === null || s.limit === undefined || Number(s.limit) === 0) return null
  return (Number(s.used) / Number(s.limit)) * 100
}

/*
  The ring.

  A fraction is a shape, and two arcs can be compared at a glance where "37 MB
  of 500 MB" against "47 MB of 1 GB" cannot. Drawn rather than charted: one
  circle, one dash offset, no library — which is also the only option, because
  ADR-0002 and ADR-0011 rule out a bundler.

  A service with no ceiling gets no ring. An empty ring would imply a limit
  that does not exist, and inventing a denominator is the failure this whole
  page exists to avoid.
*/
function ring(percent, tone) {
  const r = 26
  const c = 2 * Math.PI * r
  // A hairline at zero rather than nothing, so an unused service still reads
  // as "measured and empty" instead of "not rendered".
  const filled = Math.max(Math.min(percent, 100), percent > 0 ? 1.5 : 0.6) / 100
  return `<svg class="u-ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" class="u-ringtrack"/>
    <circle cx="32" cy="32" r="${r}" class="u-ringfill" style="
      stroke: oklch(62% 0.15 ${tone});
      stroke-dasharray: ${(c * filled).toFixed(2)} ${c.toFixed(2)};"/>
  </svg>`
}

/* Each service its own hue, so a card is recognisable before it is read. */
const TONE = {
  openrouter: 152,
  notebooklm: 248,
  tts: 292,
  supabase_db: 78,
  supabase_storage: 28,
  mcp: 196,
}

const PROVENANCE = {
  measured: { label: 'measured', why: 'Counted from our own records.' },
  reported: { label: 'reported', why: 'The provider told us this figure.' },
  estimated: { label: 'our estimate', why: 'The provider publishes no figure. This is our own count.' },
}

function card(s) {
  const pct = share(s)
  const tone = TONE[s.key] ?? 200
  const prov = PROVENANCE[s.provenance] ?? PROVENANCE.measured
  const sec = s.secondary ?? {}

  // The trio he asked for. Only where the service HAS a per-period figure —
  // storage is a level, not a flow, and "0 today" against a stock measure is
  // a category error rather than a quiet day.
  const flow =
    s.day === undefined
      ? ''
      : `<div class="u-trio">
          ${[
            ['Today', s.day],
            ['7 days', s.week],
            ['30 days', s.month],
          ]
            .map(
              ([label, v]) => `<div><span class="t-label">${label}</span>
                <b>${esc(say(v, s.unit))}</b></div>`,
            )
            .join('')}
        </div>`

  return `<article class="u-card" data-lift data-tilt="1.2">
    <div class="u-top">
      ${pct === null ? '<div class="u-noring" aria-hidden="true"></div>' : ring(pct, tone)}
      <div class="u-name">
        <b>${esc(s.name)}</b>
        <span class="t-meta">${esc(s.detail)}</span>
      </div>
      <span class="u-prov u-prov-${esc(s.provenance)}" title="${esc(prov.why)}">${esc(prov.label)}</span>
    </div>

    <div class="u-figure">
      <span class="u-used">${esc(say(s.used, s.unit))}</span>
      ${
        s.limit === null || s.limit === undefined
          ? `<span class="t-meta">${esc(s.window ?? '')}</span>`
          : `<span class="t-meta">of ${esc(say(s.limit, s.unit))}${
              s.window ? ` · ${esc(s.window)}` : ''
            }</span>`
      }
      ${pct === null ? '' : `<span class="u-pct">${pct < 0.1 && pct > 0 ? '<0.1' : pct.toFixed(1)}%</span>`}
    </div>

    ${flow}

    ${
      sec.week_limit
        ? `<p class="t-meta">${esc(say(sec.week_used, s.unit))} of ${esc(say(sec.week_limit, s.unit))} this week.</p>`
        : ''
    }
    ${sec.calls ? `<p class="t-meta">${esc(say(sec.calls, 'n'))} calls · ${esc(say(sec.tokens, 'n'))} tokens${sec.failed ? ` · ${esc(sec.failed)} failed` : ''}</p>` : ''}
    ${sec.objects ? `<p class="t-meta">${esc(sec.objects)} files.</p>` : ''}
    ${
      sec.largest
        ? `<p class="t-meta">Biggest: ${sec.largest
            .slice(0, 3)
            .map((t) => `${esc(t.table.replace('public.', ''))} ${esc(t.human)}`)
            .join(', ')}.</p>`
        : ''
    }
    ${s.note ? `<p class="u-note">${esc(s.note)}</p>` : ''}
  </article>`
}

/*
  Calls per day.

  The one series with anything to say — everything else is a flat zero, and a
  chart of a flat zero is the decorative chart §14A forbids. Drawn as an area
  so the shape of a busy day reads before any number does.
*/
function area(days) {
  if (days.length < 2) return ''
  const w = 720
  const h = 120
  const max = Math.max(...days.map((d) => d.calls), 1)
  const x = (i) => (i / (days.length - 1)) * w
  const y = (v) => h - (v / max) * (h - 14) - 4
  const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.calls).toFixed(1)}`).join(' ')
  const busiest = days.reduce((a, b) => (b.calls > a.calls ? b : a), days[0])

  return `<section class="u-chart" data-lift data-tilt="0.8">
    <div class="u-charthead">
      <span class="t-label">Model calls, by day</span>
      <span class="t-meta">Busiest: ${esc(busiest.calls)} on ${esc(
        new Date(busiest.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      )}</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="u-svg" role="img"
      aria-label="Model calls per day over the last ${esc(days.length)} days">
      <defs>
        <linearGradient id="u-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="oklch(62% 0.15 152)" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="oklch(62% 0.15 152)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${line} L${w},${h} L0,${h} Z" fill="url(#u-fade)"/>
      <path d="${line}" fill="none" stroke="oklch(62% 0.15 152)" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="u-axis">
      <span class="t-meta">${esc(new Date(days[0].day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>
      <span class="t-meta">${esc(new Date(days[days.length - 1].day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>
    </div>
  </section>`
}

/*
  What is consuming the most — his words.

  Ranked by model rather than by service, because the services are already the
  cards above and repeating them would be a chart of something already shown.
  This is the level at which a person can act: change a model, or stop asking
  for the thing that uses it.
*/
function consumers(models) {
  if (models.length === 0) return ''
  const max = Math.max(...models.map((m) => m.calls), 1)
  return `<section class="u-rank">
    <span class="t-label">What is being used the most</span>
    ${models
      .map(
        (m) => `<div class="u-rankrow">
          <span class="u-rankname" title="${esc(m.name)}">${esc(m.name.replace(/:free$/, ''))}
            ${m.name.endsWith(':free') ? '<span class="u-free">free</span>' : ''}</span>
          <span class="u-bar"><i style="width:${((m.calls / max) * 100).toFixed(1)}%"></i></span>
          <span class="u-rankn">${esc(say(m.calls, 'n'))}</span>
        </div>`,
      )
      .join('')}
  </section>`
}

export function usageTab(data = USAGE) {
  const spend = data.services.find((s) => s.unit === 'usd')
  return `<div class="setbody u-body">
    <div class="u-head" data-lift data-tilt="1.2">
      <div>
        <span class="t-label">Spent in the last 30 days</span>
        <div class="bignum">${esc(say(spend?.month ?? 0, 'usd'))}</div>
        <span class="t-meta">Target: ${esc(data.target)}</span>
      </div>
      <!--
        The harness count, said out loud.

        The first version of this ranked "fixture/free-model" as the second
        biggest consumer and "gate5-probe" as the fifth. Both are verification
        traffic and one is not a model at all. They are excluded now — but
        silently showing a smaller number invites the question of where the
        rest went, so the count is stated.
      -->
      <p class="t-meta u-excluded">Excludes ${esc(data.harness_excluded)} calls made by our own
        verification suites. Every figure on this page says where it came from.</p>
    </div>

    <div class="u-grid">${data.services.map(card).join('')}</div>

    ${area(data.by_day)}
    ${consumers(data.top_models)}
    ${growthCard(GROWTH)}
  </div>`
}

/*
  How fast the conversation is growing (#204).

  On the Usage page rather than on its own, because it is the same question as
  every other figure here — what are we spending, and how long can we keep
  spending it — and a page per number is how a dashboard becomes a filing
  cabinet.

  The numbers are MEASURED. #204 asked three questions and the first was the
  growth rate per connected surface, from real traffic, once two surfaces were
  syncing. Both are, so this is a reading rather than an estimate, and it is a
  function rather than a script so it stays true tomorrow.

  Fixtures are excluded in the RPC, which is the whole reason the Slack figure
  fell from 117 rows to 45 the moment it was measured properly. Harness traffic
  reported as growth is the trap this repository has a paragraph about.
*/
function growthCard(g) {
  if (g === null || !Array.isArray(g.surfaces)) return ''
  // An ordinary office may have no reading yet; say so rather than printing NaN or Infinity.
  const finite = (n) => Number.isFinite(Number(n)) && n !== null && n !== undefined
  const gb = (n) => (finite(n) ? `${(Number(n) / 1024 / 1024).toFixed(0)} MB` : 'an unmeasured amount')
  const pct =
    finite(g.db_bytes) && finite(g.tier_bytes) && Number(g.tier_bytes) > 0
      ? String(Math.round((Number(g.db_bytes) / Number(g.tier_bytes)) * 100))
      : 'unmeasured'
  const years = g.years_of_room === null || g.years_of_room === undefined
    ? null
    : Number(g.years_of_room)
  return `<section class="u-growth setcard">
    <header>
      <span class="t-label">The conversation</span>
      <span class="t-meta">${esc(String(g.messages_a_day))} messages a day across
        ${esc(String(g.surfaces.length))} surface${g.surfaces.length === 1 ? '' : 's'},
        about ${esc(String(g.bytes_a_message))} bytes each</span>
    </header>
    <ul class="u-surf">
      ${g.surfaces.map((s) => `<li>
        <b>${esc(String(s.surface))}</b>
        <span class="m">${esc(String(s.a_day))} a day</span>
        <span class="m">${esc(String(s.rows))} so far</span>
      </li>`).join('')}
    </ul>
    <p class="t-meta">
      The database is ${esc(gb(g.db_bytes))} of the free tier's ${esc(gb(g.tier_bytes))}
      — ${esc(pct)}${pct === 'unmeasured' ? '' : '%'}.
      ${years === null
        ? 'Nothing has been said yet, so there is no rate to project.'
        : `At this rate there is room for about ${esc(String(years))} more years of
           conversation. Nothing needs deleting, and most of it could not be:
           an answer hangs off a job, and a job is permanent by design.`}
    </p>
  </section>`
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
