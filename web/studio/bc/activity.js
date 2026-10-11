/*
  The Activity screen, drawn from the unified activity ledger (docs/activity-ledger/), for the office page and for one project.

  WHAT IT ASKS, and why it asks it. Every view and filter is a query to the gateway's activity_feed section, so a result is a
  statement about the whole history, never about the page that happens to be loaded; a keyset cursor pages older events; the
  related-activity reader (activity_chain) is asked only when a person presses for it. There is no text search: the gateway has none,
  and filtering the loaded page while implying it covered everything would be a lie, so the screen does not offer one.

  WHAT IT NEVER DOES. It does not decide anything: Needs attention is read from the project records the office already keeps
  (what is waiting on a person), with a link to the place the existing controls are, and a ledger event saying an approval was asked
  is history, never taken as still pending. It does not credit an unknown actor to anybody. It links only to a project the page knows.

  WHEN THE LEDGER IS OFF, or an office is outside the canary, or the read fails, or never answers, the screen draws the older list it
  drew before (`legacy`), so switching the ledger on can only improve this page.

  A NOTE ON COMMENTS IN THIS FILE: functions here return template literals, and a backtick inside a comment inside one ends the
  string. Comments inside returned templates use plain words only, and this file keeps its comments outside them.
*/
import { activeFilters, appendPage, clock, describe, destinationFor, exactTime, groupByDay, howWeKnow, kindWords, queryFor, RANGES, safeFacts, stageOf, VIEWS } from './activity-model.js'

const PAGE = 40
const HELD_MAX = 400
const FIRST_DEADLINE_MS = 8000
const STALE_MS = 30000

// One small mark per category, drawn on a 24 grid with a round stroke; semantic, and never the only carrier of meaning.
const ICONS = {
  request: '<path d="M4 5h16v10H9l-5 4z"/>',
  job: '<path d="M5 7h14v12H5zM9 7V5h6v2M5 12h14"/>',
  approval: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  output: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  delivery: '<path d="M4 12l16-8-6 16-3-7z"/>',
  tool: '<path d="M14 6a4 4 0 0 0-5 5l-5 5 3 3 5-5a4 4 0 0 0 5-5l-3 3-2-2z"/>',
  reliability: '<path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  usage: '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4-5"/>',
  integration: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5"/>',
  external: '<path d="M9 5h6v4H9zM6 9h12v9H6z"/><path d="M9 13h.01M15 13h.01M12 5V3"/>',
  task: '<path d="M5 5h14v14H5z"/><path d="M9 12l2 2 4-4"/>',
  document: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>',
  calendar: '<path d="M5 6h14v14H5zM5 10h14M9 3v4M15 3v4"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5"/>',
  research: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
  other: '<circle cx="12" cy="12" r="3"/>',
}
const icon = (cat, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[cat] ?? ICONS.other}</svg>`

export const createActivity = (deps) => {
  const { esc, read, crew, projects, avatar, go, repaintShell } = deps
  const fresh = (scope) => ({
    scope,
    view: 'all',
    agent: '',
    project: '',
    range: '',
    panel: false,
    events: [],
    next: null,
    partial: false,
    enabled: null,
    loading: false,
    loadingMore: false,
    error: '',
    started: false,
    loadedAt: 0,
    seq: 0,
    open: new Set(),
    chain: new Map(),
    attn: { state: 'idle', events: [] },
    legacy: () => '',
    header: () => '',
    note: '',
  })
  let S = fresh('\u0000')
  const scopeProject = () => (S.scope === '' ? '' : (projects().find((p) => p.slug === S.scope)?.id ?? ''))
  const ctxFor = () => ({ crew: crew(), projects: projects() })
  const agentName = (slug) => crew().find((c) => c.staffSlug === slug || c.slug === slug)?.name ?? slug
  const projectName = (id) => projects().find((p) => p.id === id)?.name ?? id

  // ---------------------------------------------------------------------------------------------- reading
  const withDeadline = (p, ms) =>
    Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('The office did not answer in time.')), ms))])

  const load = async ({ more = false } = {}) => {
    const mine = ++S.seq
    const q = queryFor(S, { scopeProject: scopeProject(), limit: PAGE, cursor: more ? S.next : null })
    if (more) S.loadingMore = true
    else S.loading = true
    S.error = ''
    paint()
    try {
      const a = await withDeadline(read('activity_feed', undefined, q), S.started && S.events.length > 0 ? 20000 : FIRST_DEADLINE_MS)
      // An answer to an older question is dropped: the filters have moved on, or a newer read is already in flight.
      if (mine !== S.seq) return
      S.enabled = a?.enabled === true
      const page = Array.isArray(a?.events) ? a.events : []
      S.events = more ? appendPage(S.events, page) : appendPage([], page)
      S.next = a?.next !== null && typeof a?.next === 'object' ? a.next : null
      S.partial = a?.partial === true
      S.loadedAt = Date.now()
    } catch (e) {
      if (mine !== S.seq) return
      S.error = String(e?.message ?? 'The office did not answer.')
    }
    S.loading = false
    S.loadingMore = false
    paint()
  }

  const loadAttention = async () => {
    if (S.attn.state === 'loading') return
    S.attn = { state: 'loading', events: [] }
    const mine = S.scope
    try {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      const q = { ...queryFor({ view: 'problems' }, { scopeProject: scopeProject(), limit: 8 }), since }
      const a = await withDeadline(read('activity_feed', undefined, q), 12000)
      if (S.scope !== mine) return
      S.attn = { state: 'done', events: Array.isArray(a?.events) ? a.events : [] }
    } catch {
      if (S.scope !== mine) return
      S.attn = { state: 'error', events: [] }
    }
    paint()
  }

  const loadChain = async (key, ask) => {
    if (S.chain.get(key)?.state === 'loading') return
    S.chain.set(key, { state: 'loading' })
    paintRow(key)
    try {
      const a = await withDeadline(read('activity_chain', undefined, { ...ask, visibility: 'user' }), 15000)
      S.chain.set(key, { state: 'done', events: Array.isArray(a?.events) ? a.events : [], truncated: a?.truncated ?? null, partial: a?.partial === true, complete: a?.complete === true })
    } catch (e) {
      S.chain.set(key, { state: 'error', said: String(e?.message ?? '') })
    }
    paintRow(key)
  }

  // ---------------------------------------------------------------------------------------------- drawing
  const timeTag = (iso) => `<time class="bcact-time" datetime="${esc(iso)}" title="${esc(exactTime(iso))}">${esc(clock(iso))}</time>`

  const who = (d) =>
    d.tone === 'you'
      ? `<span class="bcact-mark bcact-mark--you" aria-hidden="true">${icon('request')}</span>`
      : d.tone === 'chief' || d.tone === 'agent'
        ? `<span class="bcact-mark bcact-mark--face" aria-hidden="true">${avatar(crew().find((c) => c.staffSlug === d.slug || c.slug === d.slug) ?? { name: d.who }, 34)}</span>`
        : `<span class="bcact-mark bcact-mark--${esc(d.tone)}" aria-hidden="true">${icon(d.tone === 'external' ? 'external' : d.tone === 'unknown' ? 'other' : d.category)}</span>`

  const resultChip = (d) => (d.result === '' ? '' : `<span class="bcact-result bcact-result--${esc(d.resultTone)}">${esc(d.result)}</span>`)

  const detail = (e, d) => {
    const dest = destinationFor(d)
    const facts = safeFacts(e.metadata)
    const row = (k, v) => (v === '' ? '' : `<div class="bcact-fact"><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
    const chainKey = d.jobId !== '' ? `job:${d.jobId}` : d.correlationId !== '' ? `corr:${d.correlationId}` : ''
    const proj = d.project === undefined ? esc(d.projectName) : `<button type="button" class="bcact-link" data-act-go="${esc(`/p/${d.project.slug}`)}" data-act-focus="proj:${esc(d.id)}">${esc(d.projectName)}</button>`
    return `<div class="bcact-detail-in">
      <p class="bcact-full">${esc(d.sentence)}</p>
      <dl class="bcact-facts">
        ${row('Who', esc(d.who))}
        ${row('When', esc(exactTime(d.at)))}
        ${row('Project', d.projectName === '' ? '' : proj)}
        ${row('Result', d.result === '' ? '' : esc(d.result))}
        ${row('Came through', esc(d.via))}
        ${row('How we know', esc(howWeKnow(e)))}
        ${facts.map(([k, v]) => row(k, esc(v))).join('')}
      </dl>
      <div class="bcact-actions">
        ${dest === null ? '' : `<button type="button" class="bcbtn bcbtn--outline" data-act-go="${esc(dest.to)}" data-act-focus="dest:${esc(d.id)}">${esc(dest.label)}</button>`}
        ${chainKey === '' ? '' : `<button type="button" class="bcbtn bcbtn--outline" data-act-chain="${esc(chainKey)}" data-act-job="${esc(d.jobId)}" data-act-corr="${esc(d.correlationId)}" data-act-focus="chain:${esc(d.id)}">View related activity</button>`}
      </div>
      <div class="bcact-chain" data-act-chainbox="${esc(chainKey)}" aria-live="polite">${chainKey === '' ? '' : chainHtml(chainKey, d.id)}</div>
      <details class="bcact-tech"><summary data-act-focus="tech:${esc(d.id)}">Technical details</summary>
        <dl class="bcact-facts">
          ${row('Event', `<code>${esc(e.id)}</code>`)}
          ${row('Type', `<code>${esc(e.type)}</code>`)}
          ${row('Recorded from', `<code>${esc(e.source)}</code>`)}
          ${row('Job', d.jobId === '' ? '' : `<code>${esc(d.jobId)}</code>`)}
          ${row('Correlation', d.correlationId === '' ? '' : `<code>${esc(d.correlationId)}</code>`)}
          ${row('Evidence', e.evidence?.kind === undefined ? '' : `<code>${esc(String(e.evidence.kind))}</code>`)}
        </dl>
      </details>
    </div>`
  }

  const chainHtml = (key, selfId) => {
    const c = S.chain.get(key)
    if (c === undefined) return ''
    if (c.state === 'loading') return '<p class="bcact-note" role="status">Loading the related activity…</p>'
    if (c.state === 'error') return `<p class="bcact-note bcact-note--bad" role="alert">The related activity could not be loaded${c.said === '' ? '' : `: ${esc(c.said)}`}. Press the button to try again.</p>`
    if (c.events.length === 0) return '<p class="bcact-note">Nothing else is recorded for this piece of work.</p>'
    const items = c.events
      .map((x) => {
        const d = describe(x, ctxFor())
        return `<li class="bcact-step${x.id === selfId ? ' is-self' : ''}${d.problem ? ' is-problem' : ''}">
          <span class="bcact-stage">${esc(stageOf(x.type))}</span>
          <span class="bcact-stepbody"><span class="bcact-steptext">${esc(d.sentence)}</span>
          <span class="bcact-stepmeta">${esc(d.who)} · ${esc(exactTime(d.at))}${d.result === '' ? '' : ` · ${esc(d.result)}`}${d.reported ? ' · reported, not confirmed' : ''}</span></span>
        </li>`
      })
      .join('')
    const cut = c.truncated === 'oldest' ? `<p class="bcact-note bcact-note--warn">Showing the newest ${String(c.events.length)} events of this piece of work. Earlier ones are not shown because the reader is limited to ${String(c.events.length)}.</p>` : ''
    const part = c.partial && c.truncated !== 'oldest' ? '<p class="bcact-note bcact-note--warn">This history may be incomplete.</p>' : ''
    return `${cut}${part}<ol class="bcact-steps" aria-label="Related activity, oldest first">${items}</ol>`
  }

  const item = (e) => {
    const d = describe(e, ctxFor())
    const open = S.open.has(d.id)
    const dom = `bcact-d-${d.id}`
    return `<article class="bcact-item bcact-item--${esc(d.tone)}${d.problem ? ' is-problem' : ''}${open ? ' is-open' : ''}" data-act-item="${esc(d.id)}">
      ${who(d)}
      <div class="bcact-main">
        <span class="bcact-who">${esc(d.who)}${d.reported ? ' <span class="bcact-tag">Reported</span>' : ''}</span>
        <button type="button" class="bcact-sentence" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${esc(dom)}" data-act-toggle="${esc(d.id)}" data-act-focus="row:${esc(d.id)}">${esc(d.sentence)}</button>
        ${d.projectName === '' && d.via === '' && d.result === '' ? '' : `<span class="bcact-meta">${d.projectName === '' ? '' : `<span class="bcact-where"><span class="bcact-cat" title="${esc(d.category)}">${icon(d.category, 14)}</span><span class="bcact-proj">${esc(d.projectName)}</span></span>`}${d.via === '' ? '' : `<span class="bcact-via">via ${esc(d.via)}</span>`}${resultChip(d)}</span>`}
      </div>
      ${timeTag(d.at)}
      <div class="bcact-detail" id="${esc(dom)}" ${open ? '' : 'hidden'}>${open ? detail(e, d) : ''}</div>
    </article>`
  }

  const groups = () =>
    groupByDay(S.events)
      .map((g) => `<section class="bcact-day" aria-labelledby="bcact-h-${esc(g.key)}"><h2 class="bcact-dayhead" id="bcact-h-${esc(g.key)}">${esc(g.label)}</h2>${g.events.map(item).join('')}</section>`)
      .join('')

  const attentionItems = () => {
    const scope = scopeProject()
    return projects()
      .filter((p) => S.scope === '' || p.slug === S.scope)
      .flatMap((p) => (Array.isArray(p.waiting) ? p.waiting.map((w) => ({ p, w })) : []))
      .map(({ p, w }, i) => ({ p, w, i, scope }))
  }

  const attentionPanel = () => {
    const items = attentionItems()
    const waiting = items
      .map(
        ({ p, w, i }) => `<li class="bcact-need">
          <span class="bcact-mark bcact-mark--wait" aria-hidden="true">${icon('approval')}</span>
          <span class="bcact-needbody"><span class="bcact-needtitle">${esc(String(w.what ?? 'Something is waiting for you'))}</span>
          <span class="bcact-meta"><span class="bcact-proj">${esc(p.name)}</span>${w.when ? `<span class="bcact-via">${esc(String(w.when))}</span>` : ''}<span class="bcact-result bcact-result--wait">Waiting for you</span></span></span>
          <button type="button" class="bcbtn bcbtn--outline" data-act-go="${esc(`/p/${p.slug}/team`)}" data-act-focus="need:${String(i)}">Review</button>
        </li>`,
      )
      .join('')
    const problems = S.attn.events.map((e) => describe(e, ctxFor()))
    const probList =
      S.attn.state === 'loading'
        ? '<p class="bcact-note" role="status">Checking what went wrong lately…</p>'
        : S.attn.state === 'error'
          ? '<p class="bcact-note bcact-note--warn">Recent problems could not be read just now.</p>'
          : problems.length === 0
            ? '<p class="bcact-note">Nothing has gone wrong in the last 7 days.</p>'
            : `<ul class="bcact-needs">${problems
                .map(
                  (d) => `<li class="bcact-need bcact-need--past">
                  <span class="bcact-mark bcact-mark--bad" aria-hidden="true">${icon(d.category)}</span>
                  <span class="bcact-needbody"><span class="bcact-needtitle">${esc(d.sentence)}</span>
                  <span class="bcact-meta">${esc(d.who)}${d.projectName === '' ? '' : ` · ${esc(d.projectName)}`} · ${esc(exactTime(d.at))}${resultChip(d)}</span></span>
                  <button type="button" class="bcbtn bcbtn--outline" data-act-open="${esc(d.id)}" data-act-focus="past:${esc(d.id)}">Open in the timeline</button>
                </li>`,
                )
                .join('')}</ul>`
    return `<section class="bcact-attn" aria-labelledby="bcact-attn-h">
      <h2 class="bcact-subhead" id="bcact-attn-h">Waiting for you</h2>
      ${items.length === 0 ? '<p class="bcact-note">Nothing is waiting for a decision from you. Approvals and blocked work appear here the moment they need you.</p>' : `<ul class="bcact-needs">${waiting}</ul>`}
      <h2 class="bcact-subhead" id="bcact-prob-h">Went wrong in the last 7 days</h2>
      <p class="bcact-note bcact-note--quiet">These are records of what happened. They say nothing about whether it has since been put right.</p>
      ${probList}
    </section>`
  }

  const controls = () => {
    const counts = activeFilters(S, { agentName, projectName, scopeProject: scopeProject() })
    const chips = VIEWS.map((v) => {
      const on = S.view === v.id
      const waiting = v.id === 'attention' ? attentionItems().length : 0
      // A phone has room for one word: the short name is shown there and the full one stays the accessible name.
      return `<button type="button" class="bcsrcchip${on ? ' is-on' : ''}" data-act-view="${esc(v.id)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${esc(v.name)}${waiting > 0 ? `, ${String(waiting)}` : ''}" data-act-focus="view:${esc(v.id)}"><span class="bcact-long" aria-hidden="true">${esc(v.name)}</span><span class="bcact-short" aria-hidden="true">${esc(v.short)}</span>${waiting > 0 ? ` <span class="bcact-count">${String(waiting)}</span>` : ''}</button>`
    }).join('')
    const agents = crew()
      .map((c) => `<option value="${esc(c.staffSlug ?? c.slug)}"${S.agent === (c.staffSlug ?? c.slug) ? ' selected' : ''}>${esc(c.name)}</option>`)
      .join('')
    const projs = projects()
      .filter((p) => p.slug !== 'unnamed' && typeof p.id === 'string')
      .map((p) => `<option value="${esc(p.id)}"${S.project === p.id ? ' selected' : ''}>${esc(p.name)}</option>`)
      .join('')
    const ranges = RANGES.map((r) => `<option value="${esc(r.id)}"${S.range === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')
    const nFilters = counts.filter((c) => c.key !== 'view').length
    return `<div class="bcact-controls">
      <div class="bcsrcchips bcact-views" role="group" aria-label="Show">${chips}</div>
      <div class="bcact-filterbar">
        <button type="button" class="bcbtn bcact-filterbtn" data-act-panel aria-expanded="${S.panel ? 'true' : 'false'}" aria-controls="bcact-panel" data-act-focus="panel">Filters${nFilters > 0 ? ` <span class="bcact-count">${String(nFilters)}</span>` : ''}</button>
        <ul class="bcact-active" aria-label="Active filters">${counts
          .map((c) => `<li><button type="button" class="bcact-x" data-act-clear="${esc(c.key)}" aria-label="Remove filter: ${esc(c.label)}" data-act-focus="x:${esc(c.key)}">${esc(c.label)} <span aria-hidden="true">×</span></button></li>`)
          .join('')}${counts.length > 0 ? '<li><button type="button" class="bcact-clearall" data-act-clear="all" data-act-focus="x:all">Clear all</button></li>' : ''}</ul>
      </div>
      <div class="bcact-panel" id="bcact-panel" ${S.panel ? '' : 'hidden'}>
        <label class="bcact-field"><span>Who</span><select data-act-sel="agent" data-act-focus="sel:agent"><option value="">Everyone</option>${agents}</select></label>
        ${scopeProject() === '' ? `<label class="bcact-field"><span>Project</span><select data-act-sel="project" data-act-focus="sel:project"><option value="">All projects</option>${projs}</select></label>` : ''}
        <label class="bcact-field"><span>When</span><select data-act-sel="range" data-act-focus="sel:range">${ranges}</select></label>
      </div>
    </div>`
  }

  const skeleton = () =>
    `<div class="bcact-sk" role="status" aria-label="Loading activity">${Array.from({ length: 6 }, () => '<div class="bcact-skrow"><span class="bcact-skmark"></span><span class="bcact-skbody"><span class="bcact-skline"></span><span class="bcact-skline bcact-skline--short"></span></span></div>').join('')}</div>`

  const timeline = () => {
    if (S.view === 'attention') return attentionPanel()
    if (S.loading && S.events.length === 0) return skeleton()
    if (S.error !== '' && S.events.length === 0)
      return `<div class="bcempty" role="alert"><b>The activity could not be loaded</b><span>${esc(S.error)}</span><button type="button" class="bcbtn bcbtn--outline" data-act-retry data-act-focus="retry">Try again</button></div>`
    if (S.events.length === 0) {
      const narrowed = activeFilters(S, { scopeProject: scopeProject() }).length > 0
      return narrowed
        ? '<div class="bcempty"><b>Nothing matches</b><span>No activity in the whole history fits these filters.</span><button type="button" class="bcbtn bcbtn--outline" data-act-clear="all" data-act-focus="x:all">Clear the filters</button></div>'
        : '<div class="bcempty"><b>Nothing yet</b><span>What you and your team do is listed here, newest first.</span></div>'
    }
    const more =
      S.next === null
        ? S.events.length >= HELD_MAX
          ? ''
          : `<p class="bcact-end">${S.partial ? 'The search stopped at the limit of what it reads in one go. Narrow the filters to look further back.' : 'That is everything.'}</p>`
        : S.events.length >= HELD_MAX
          ? `<p class="bcact-end">Showing the newest ${String(S.events.length)}. Narrow the filters (for example by date or person) to see older activity.</p>`
          : `<div class="bcact-more"><button type="button" class="bcbtn bcbtn--outline" data-act-more ${S.loadingMore ? 'disabled' : ''} data-act-focus="more">${S.loadingMore ? 'Loading…' : 'Show older activity'}</button>${S.partial ? '<p class="bcact-note bcact-note--quiet">This filter is selective, so a page can hold fewer than usual. Keep going to look further back.</p>' : ''}</div>`
    const failedMore = S.error !== '' ? `<p class="bcact-note bcact-note--warn" role="alert">${esc(S.error)}</p>` : ''
    const refreshing = S.loading ? '<p class="bcact-note bcact-note--quiet" role="status">Updating…</p>' : ''
    return `${refreshing}${groups()}${failedMore}${more}`
  }

  // What is running now is read from the office's own record of in-flight requests (the same list the Agentic Team page draws), never
  // inferred from ledger events: an event saying work started is history, not a statement that it has not since finished.
  const happeningNow = () => {
    if (S.view !== 'all') return ''
    const items = projects()
      .filter((p) => S.scope === '' || p.slug === S.scope)
      .flatMap((p) => (Array.isArray(p.requests) ? p.requests : []).filter((r) => r?.state === 'working').map((r) => ({ p, r })))
    if (items.length === 0) return '<p class="bcact-now bcact-now--none" role="status">Nothing is running right now.</p>'
    const rows = items
      .slice(0, 3)
      .map(({ p, r }) => {
        const who = crew().find((c) => c.slug === r.who || c.staffSlug === r.who)?.name ?? ''
        const said = String(r.ask ?? '').replace(/\s+/g, ' ').trim()
        // A request with no text of its own is stored under its job kind; a kind is never shown as wording.
        const ask = said === '' || /^[a-z]+(\.[a-z_]+)+$/.test(said) ? kindWords(said === '' ? 'office.instruction' : said) : said
        return `<li class="bcact-nowrow"><span class="bcact-pulse" aria-hidden="true"></span><span class="bcact-nowbody"><span class="bcact-nowtitle">${esc(ask.length > 140 ? `${ask.slice(0, 137)}…` : ask)}</span><span class="bcact-meta">${who === '' ? '' : `<span>${esc(who)} is working on it</span>`}<span class="bcact-proj">${esc(p.name)}</span></span></span><button type="button" class="bcbtn bcbtn--outline" data-act-go="${esc(`/p/${p.slug}/team`)}" data-act-focus="now:${esc(String(r.id ?? p.slug))}">Open</button></li>`
      })
      .join('')
    return `<section class="bcact-now" aria-labelledby="bcact-now-h"><h2 class="bcact-subhead" id="bcact-now-h">Happening now${items.length > 3 ? ` (${String(items.length)})` : ''}</h2><ul class="bcact-nowlist">${rows}</ul></section>`
  }

  const body = () => {
    // Off, outside the canary, failed on the first read, or never answered: the older list, exactly as before.
    const unavailable = S.enabled === false || (S.enabled === null && S.error !== '')
    if (unavailable) return S.legacy()
    if (S.enabled === null) {
      const old = S.legacy()
      return `${old.includes('bcitem') ? '' : skeleton()}${old}<p class="bcact-note bcact-note--quiet" role="status">Loading the full timeline…</p>`
    }
    const waiting = attentionItems().length
    const banner =
      S.view !== 'attention' && waiting > 0
        ? `<button type="button" class="bcact-banner" data-act-view="attention" data-act-focus="banner"><span class="bcact-mark bcact-mark--wait" aria-hidden="true">${icon('approval')}</span><span><b>${String(waiting)} ${waiting === 1 ? 'thing needs' : 'things need'} you</b><span>See what is waiting for your decision</span></span><span aria-hidden="true">›</span></button>`
        : ''
    return `${S.header()}${controls()}${banner}${happeningNow()}<div class="bcact-list" data-act-list>${timeline()}</div>`
  }

  const html = () => body()

  // ---------------------------------------------------------------------------------------------- painting (no shell redraw)
  const roots = () => [...document.querySelectorAll('[data-bc-activity]')]
  const paint = () => {
    const focus = document.activeElement?.getAttribute?.('data-act-focus') ?? ''
    const y = globalThis.scrollY
    for (const el of roots()) el.innerHTML = html()
    if (focus !== '') {
      const back = [...document.querySelectorAll('[data-bc-activity] [data-act-focus]')].find((n) => n.getAttribute('data-act-focus') === focus)
      back?.focus({ preventScroll: true })
    }
    if (Math.abs(globalThis.scrollY - y) > 1) globalThis.scrollTo({ top: y, behavior: 'instant' })
  }
  const paintRow = (chainKey) => {
    for (const box of document.querySelectorAll('[data-bc-activity] [data-act-chainbox]')) {
      if (box.getAttribute('data-act-chainbox') !== chainKey) continue
      const item = box.closest('[data-act-item]')
      box.innerHTML = chainHtml(chainKey, item?.getAttribute('data-act-item') ?? '')
    }
  }

  // ---------------------------------------------------------------------------------------------- the shell's entry points
  /** Called by the shell on every redraw of an Activity screen. Starts the first read once; never starts one per redraw. */
  const render = (scope, legacy, header = () => '') => {
    if (S.scope !== scope) S = fresh(scope)
    S.legacy = legacy
    S.header = header
    if (!S.started) {
      S.started = true
      queueMicrotask(() => {
        void load()
        if (S.view === 'attention') void loadAttention()
      })
    } else if (!S.loading && S.enabled === true && Date.now() - S.loadedAt > STALE_MS) {
      queueMicrotask(() => void load())
    }
    return `<div class="bcact" data-bc-activity data-act-scope="${esc(scope)}">${html()}</div>`
  }

  const reload = (keepOpen = false) => {
    S.seq += 1
    S.events = []
    S.next = null
    S.partial = false
    if (!keepOpen) S.open = new Set()
    S.error = ''
    void load()
  }

  const wire = (root) => {
    for (const el of root.querySelectorAll('[data-bc-activity]')) {
      if (el.dataset.actWired === '1') continue
      el.dataset.actWired = '1'
      el.addEventListener('click', (ev) => {
        const t = ev.target instanceof Element ? ev.target : null
        const hit = (sel) => t?.closest(sel)
        let b
        if ((b = hit('[data-act-view]'))) {
          S.view = b.getAttribute('data-act-view')
          if (S.view === 'attention') void loadAttention()
          else reload()
          paint()
        } else if ((b = hit('[data-act-toggle]'))) {
          const id = b.getAttribute('data-act-toggle')
          if (S.open.has(id)) S.open.delete(id)
          else S.open.add(id)
          const ev2 = S.events.find((x) => x.id === id)
          const art = b.closest('[data-act-item]')
          const pane = art?.querySelector('.bcact-detail')
          if (art !== null && pane !== null && ev2 !== undefined) {
            const isOpen = S.open.has(id)
            b.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
            art.classList.toggle('is-open', isOpen)
            pane.hidden = !isOpen
            pane.innerHTML = isOpen ? detail(ev2, describe(ev2, ctxFor())) : ''
          }
        } else if ((b = hit('[data-act-chain]'))) {
          const key = b.getAttribute('data-act-chain')
          const job = b.getAttribute('data-act-job')
          const corr = b.getAttribute('data-act-corr')
          void loadChain(key, job !== '' ? { job } : { correlation: corr })
        } else if ((b = hit('[data-act-go]'))) {
          go(b.getAttribute('data-act-go'))
        } else if ((b = hit('[data-act-panel]'))) {
          S.panel = !S.panel
          paint()
        } else if ((b = hit('[data-act-clear]'))) {
          const k = b.getAttribute('data-act-clear')
          if (k === 'all' || k === 'view') S.view = 'all'
          if (k === 'all' || k === 'agent') S.agent = ''
          if (k === 'all' || k === 'project') S.project = ''
          if (k === 'all' || k === 'range') S.range = ''
          reload()
          paint()
        } else if ((b = hit('[data-act-more]'))) {
          if (!S.loadingMore && S.next !== null) void load({ more: true })
        } else if ((b = hit('[data-act-retry]'))) {
          reload()
        } else if ((b = hit('[data-act-open]'))) {
          // From the recent-problems list to the same event: the problems view over the same 7 days is exactly the query that list
          // came from, so the newest problems are the first rows and the one pressed is among them.
          S.view = 'problems'
          S.agent = ''
          S.project = ''
          S.range = '7'
          S.open = new Set([b.getAttribute('data-act-open')])
          reload(true)
          paint()
        }
      })
      el.addEventListener('change', (ev) => {
        const s = ev.target instanceof Element ? ev.target.closest('[data-act-sel]') : null
        if (s === null) return
        S[s.getAttribute('data-act-sel')] = s.value
        reload()
        paint()
      })
    }
  }

  const reset = () => {
    S = fresh('\u0000')
  }
  const peek = () => ({ scope: S.scope, view: S.view, held: S.events.length, enabled: S.enabled })
  void repaintShell
  return { render, wire, reset, peek }
}

// ---------------------------------------------------------------------------------------------- the one instance the shell and wire share
let inst = null
export const configure = (deps) => {
  inst = createActivity(deps)
}
export const render = (scope, legacy, header) => (inst === null ? legacy() : inst.render(scope, legacy, header))
export const wire = (root) => inst?.wire(root)
export const reset = () => inst?.reset()
export const peek = () => inst?.peek() ?? null
