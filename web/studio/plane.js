/**
 * The project as a living map (#25).
 *
 * Grant, 15 September 2026, verbatim in
 * `docs/spec/project-dashboard-design-direction-2026-09-15.md`:
 *
 *   "I want to see my agents, their connected third-party services, and the
 *   tasks and documents associated with their work, understand how they
 *   relate, and interact with them directly."
 *
 *   "The dashboard should feel like a living, interactive map of the project,
 *   with clarity and space at its core."
 *
 * And the sentence that decides the visual budget, which is the hard part:
 *
 *   "Keep text short and useful. Show names, status, and essential context;
 *   reveal the rest when I interact. Give the project room to breathe instead
 *   of filling the screen with oversized headings, explanatory paragraphs,
 *   decorative images, or bulky panels."
 *
 * ## What a card is allowed to say
 *
 * Two lines. A glyph and a name on the first; a state dot, a state WORD and a
 * short count on the second. Nothing else — no description, no metrics strip,
 * no buttons on the face. That is the whole substance of the Railway reference
 * he sent, and it is the rule most likely to be eroded by the next person who
 * has one more useful fact to show.
 *
 * The state word is not decoration. Grant: *"Keep status understandable
 * without color alone"*, and it is also §28 of the QA standard. The dot is the
 * fast read; the word is the accessible one.
 *
 * ## Where the shapes come from
 *
 * `app.studio_plane` (0378), which derives every edge from the column that
 * already holds the fact. This module does no inference of its own — the one
 * edge nothing stores, agent-uses-service, arrives with `derived: true` and the
 * sentence explaining it, and is drawn differently for exactly that reason.
 * Grant: *"Drawing a connection must not falsely imply that access has been
 * granted or setup has succeeded."*
 *
 * ## The class names carry a prefix on purpose
 *
 * `.pcard` was already the contact card, three thousand lines away in the same
 * stylesheet. CLAUDE.md records what a class name defined twice costs here —
 * `.stage` was a status pill and a pannable surface, and the collision was
 * harmless for weeks until one of them was put in a grid and pushed the page
 * 660px down. Everything this module draws is `map…`.
 *
 * ## Coordinates
 *
 * Two spaces, and keeping them apart is most of the code. FIELD coordinates are
 * where the cards live and what gets saved; SCREEN coordinates are what a
 * pointer event reports. The field is one transformed element, so a conversion
 * is `(screen - origin) / zoom` and nothing needs to know about scroll.
 */

/** The card, in field units. One size for every kind — §19's coherence. */
/*
  208, not 236, and the reason is arithmetic rather than taste.

  Four columns of 236 with a 340 gap make a field 1,400px wide. A 1440 window
  gives the port about 1,150 after the rail, so the first fit landed at 0.82 —
  and 0.82 takes the 14px card name to 11.5px, under the 12px floor the visual
  standard sets and `verify:ui` enforces. A map whose default view is below the
  type floor is a map that has to be zoomed before it can be read.

  At 208 with a 268 gap the field is 1,142px and the first fit is 1.0, so the
  default view is the designed size. The cards lose 28px of width they were
  not using: two lines of short text and a 20px glyph.
*/
export const CARD = { w: 208, h: 64 }
const GAP = { x: 268, y: 88 }

/** Which column a kind sits in when nobody has moved it. */
const COLUMN = { service: 0, reference: 0, agent: 1, task: 2, document: 3 }

/**
 * A glyph per kind.
 *
 * Inline paths rather than an icon font or a sprite: the studio has no build
 * step (ADR-0002), and #221 — the icon library — is still open and explicitly
 * in tension with the restraint direction, so this adds four shapes rather
 * than a dependency.
 */
const GLYPH = {
  agent: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5"/>',
  service: '<rect x="3.5" y="4.5" width="17" height="6" rx="2"/><rect x="3.5" y="13.5" width="17" height="6" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  reference: '<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.2 1.2"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.2-1.2"/>',
  task: '<rect x="4" y="4.5" width="16" height="15" rx="2.5"/><path d="M8.5 12l2.4 2.4 4.6-5"/>',
  document: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/>',
}

/** The state words each kind can carry, and which are worth a colour. */
const TONE = {
  working: 'go', connected: 'go', open: 'go', ready: 'calm', done: 'calm',
  idle: 'calm', 'a pointer': 'calm',
  'needs attention': 'warn', blocked: 'warn', 'not connected': 'warn',
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Where every node goes.
 *
 * A saved position wins; anything without one is placed in its kind's column,
 * in the order the graph returned it. That ordering is `app.studio_plane`'s and
 * is stable, so a project whose cards have never been moved looks the same on
 * every visit — an arrangement that reshuffles itself is one nobody can build a
 * memory of.
 */
export function layout(nodes, saved) {
  const used = {}
  const at = {}
  for (const n of nodes) {
    const put = saved?.[n.id]
    if (put && Number.isFinite(put.x) && Number.isFinite(put.y)) {
      at[n.id] = { x: put.x, y: put.y }
      continue
    }
    const col = COLUMN[n.kind] ?? 3
    const row = used[col] ?? 0
    used[col] = row + 1
    at[n.id] = { x: 40 + col * GAP.x, y: 40 + row * GAP.y }
  }
  return at
}

/** The smallest box containing every card, plus room to breathe. */
export function extent(at) {
  const xs = Object.values(at).map((p) => p.x)
  const ys = Object.values(at).map((p) => p.y)
  if (xs.length === 0) return { w: 1200, h: 700 }
  return {
    // Room to breathe, and not a screen of it: the padding is what you pan
    // into, and 240 on the right was a third of the fit's scale spent on
    // nothing.
    w: Math.max(...xs) + CARD.w + 90,
    h: Math.max(...ys) + CARD.h + 140,
  }
}

/** Where a line leaves and arrives: the middle of the facing edge. */
const port = (a, b) => {
  const ac = { x: a.x + CARD.w / 2, y: a.y + CARD.h / 2 }
  const bc = { x: b.x + CARD.w / 2, y: b.y + CARD.h / 2 }
  const rightwards = bc.x >= ac.x
  return {
    x1: rightwards ? a.x + CARD.w : a.x,
    y1: ac.y,
    x2: rightwards ? b.x : b.x + CARD.w,
    y2: bc.y,
  }
}

/**
 * The curve between two cards, exported because a drag has to redraw it.
 *
 * One definition, two callers: the renderer below and the pointermove handler
 * in `app.js`. CLAUDE.md records what a list built twice costs — the command
 * bar's renderer and its keyboard picker each assembled their own — and a
 * curve computed twice is the same defect with a subtler symptom: the lines
 * would simply be slightly wrong while you were dragging, and right again the
 * moment you let go.
 */
export function pathFor(a, b) {
  const p = port(a, b)
  const bend = Math.max(40, Math.abs(p.x2 - p.x1) * 0.42)
  const dir = p.x2 >= p.x1 ? 1 : -1
  return `M ${p.x1} ${p.y1} C ${p.x1 + bend * dir} ${p.y1}, ${p.x2 - bend * dir} ${p.y2}, ${p.x2} ${p.y2}`
}

function wire(e, at) {
  const a = at[e.from]
  const b = at[e.to]
  if (!a || !b) return ''
  const d = pathFor(a, b)
  return `<path class="mapline ${e.derived === true ? 'guess' : ''}" d="${d}"
            data-edge="${esc(e.from)}|${esc(e.to)}"><title>${
              esc(e.derived === true ? `${e.verb} — ${e.because ?? 'derived'}` : e.verb)
            }</title></path>`
}

function card(n, at) {
  const p = at[n.id]
  if (!p) return ''
  const tone = TONE[n.state] ?? 'calm'
  const glyph = GLYPH[n.kind] ?? GLYPH.document
  return `<button class="mapcard k-${esc(n.kind)}" data-node="${esc(n.id)}"
            style="--x:${p.x}px;--y:${p.y}px"
            aria-label="${esc(n.name)}, ${esc(n.kind)}, ${esc(n.state)}">
    <span class="mapglyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
      stroke-linejoin="round">${glyph}</svg></span>
    <span class="mapname">${esc(n.name)}</span>
    <span class="mapstate t-${tone}">
      <span class="mapdot" aria-hidden="true"></span>${esc(n.state)}${
        n.says ? ` <span class="mapsays">${esc(n.says)}</span>` : ''
      }</span>
  </button>`
}

/**
 * The whole plane.
 *
 * One transformed field holding one SVG layer and one button per node, inside a
 * port that clips it. The controls sit in the bottom-left corner, which is
 * where the reference puts them and, more usefully, is the one corner nothing
 * else in this product uses.
 */
export function draw(graph, saved, view, pick) {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const at = layout(nodes, saved)
  const box = extent(at)
  /*
    Nothing saved means FIT, not 1:1 at the origin.

    The first capture of this screen had the documents column sliced by the
    right-hand edge, because the field is wider than the port and the default
    view was the top-left corner at full size. A map whose first impression is
    "there is something over there you cannot see" fails the sentence this
    whole screen is for: *"I can open a project and immediately understand what
    is involved."*

    The real fit needs the port's measured width, which does not exist until
    this html is in the document, so `data-fit` asks the wiring to do it on the
    first paint and the numbers below are only what is painted for the frame
    before that.
  */
  /*
    Always fit, every open.

    The pan and the zoom are navigation rather than arrangement, and are stored
    nowhere — see the note on `remember` in app.js for what persisting them
    cost. `data-fit` asks the wiring to measure the port and place the field;
    the numbers here are only what is painted for the frame before that.
  */
  void view
  const k = 1
  const x = 0
  const y = 0

  if (nodes.length === 0) {
    /*
      Empty because new, not empty because broken (#123).

      A plane with no cards and no explanation is indistinguishable from one
      that failed to load, and this is the screen a brand-new project opens on.
    */
    return `<div class="planeport" data-plane>
      <div class="planeempty">
        <p class="t-lead">Nothing on the map yet.</p>
        <p class="m">Attach a source or ask the team something, and the people and
        services that touch this project will appear here.</p>
      </div>
    </div>`
  }

  return `<div class="planeport" data-plane tabindex="0" data-fit
              aria-label="The project map. Arrow keys pan, plus and minus zoom.">
    <div class="planefield" data-field
         style="--px:${x}px;--py:${y}px;--pk:${k};width:${box.w}px;height:${box.h}px">
      <svg class="plines" width="${box.w}" height="${box.h}" aria-hidden="true">
        ${edges.map((e) => wire(e, at)).join('')}
      </svg>
      ${nodes.map((n) => card(n, at)).join('')}
    </div>
    <div class="planectl">
      <button class="mapbtn" data-zoom="in" aria-label="Zoom in">+</button>
      <button class="mapbtn" data-zoom="out" aria-label="Zoom out">&minus;</button>
      <button class="mapbtn" data-zoom="fit" aria-label="Fit the whole map">&#9633;</button>
      <button class="mapbtn" data-zoom="reset" aria-label="Put every card back where it started">&#8634;</button>
    </div>
    <p class="planehint m" data-hint>${esc(String(nodes.length))} on the map</p>
    ${aside(nodes.find((n) => n.id === pick) ?? null, edges, nodes)}
  </div>`
}

/**
 * A graph from whatever the prototype holds, for when there is no office.
 *
 * Not a second source of truth: the SHAPE is `app.studio_plane`'s and the field
 * names are identical, so the renderer above has one input and the mock is a
 * different set of rows through the same door. A renderer with two input shapes
 * is a renderer that renders one of them badly.
 */
export function mock(p, crew) {
  const nodes = []
  const edges = []
  const who = new Set()
  for (const r of p.requests ?? []) if (r.who) who.add(r.who)
  for (const a of p.activity ?? []) if (a.who) who.add(a.who)

  for (const slug of who) {
    const c = (crew ?? []).find((m) => m.slug === slug)
    if (!c) continue
    const mine = (p.requests ?? []).filter((r) => r.who === slug)
    const live = mine.filter((r) => r.state === 'working' || r.state === 'running').length
    nodes.push({
      id: `agent:${slug}`, kind: 'agent', ref: slug, name: c.name, sub: c.role,
      state: live > 0 ? 'working' : mine.length > 0 ? 'done' : 'idle',
      says: live > 0 ? `${live} in hand` : mine.length > 0 ? `${mine.length} answered` : 'nothing yet',
    })
  }

  for (const [i, s] of (p.sources ?? []).entries()) {
    const id = `service:${s.id ?? i}`
    const reference = s.kind === 'reference'
    nodes.push({
      id, kind: reference ? 'reference' : 'service', ref: String(s.id ?? i),
      name: s.name, sub: s.what, url: s.url ?? null,
      state: reference ? 'a pointer' : s.health === 'ok' ? 'connected' : 'needs attention',
      says: reference ? 'nothing reads this' : s.last ? `read ${s.last}` : 'never read',
    })
  }

  for (const [i, t] of (p.tasks ?? []).slice(0, 8).entries()) {
    nodes.push({
      id: `task:${i}`, kind: 'task', ref: String(i), name: t.title,
      sub: t.due ?? null, state: t.done === true ? 'done' : 'open', says: t.who ?? '',
    })
  }

  for (const [i, d] of (p.documents ?? []).slice(0, 8).entries()) {
    nodes.push({
      id: `doc:${i}`, kind: 'document', ref: String(i), name: d.title,
      sub: d.by ?? null, state: 'ready', says: d.kind ?? 'document',
    })
  }

  /*
    Edges only where the mock actually knows one. A prototype that draws lines
    it invented would teach the wrong thing about the product, and this screen
    is the one Grant judges the direction from.
  */
  for (const [i, r] of (p.requests ?? []).entries()) {
    if (r.who && r.output) {
      const doc = (p.documents ?? []).findIndex((d) => d.title === r.output.title)
      if (doc >= 0) {
        edges.push({ from: `agent:${r.who}`, to: `doc:${doc}`, verb: 'produced', derived: false })
      }
    }
    void i
  }
  return { nodes, edges }
}

/**
 * What is behind a card, in context.
 *
 * Grant: *"Reveal details in context through a side panel or expanding view, so
 * I keep my place in the project."* So it sits INSIDE the plane's own port,
 * over the plane rather than instead of it — the map stays on screen, the
 * cards stay where they are, and closing it puts you back with no navigation
 * at all.
 *
 * It carries the one thing a card deliberately does not: what this node is
 * connected to, in words. That is the answer to "how does their work connect",
 * and a line on a canvas answers it only for someone already looking at the
 * right part of the canvas.
 */
function aside(n, edges, nodes) {
  if (n === null) return ''
  const name = (id) => nodes.find((x) => x.id === id)?.name ?? id
  const out = edges.filter((e) => e.from === n.id)
  const into = edges.filter((e) => e.to === n.id)
  const links = [
    ...out.map((e) => ({ e, other: e.to, way: 'to' })),
    ...into.map((e) => ({ e, other: e.from, way: 'from' })),
  ]
  const tone = TONE[n.state] ?? 'calm'
  return `<aside class="mapaside" data-aside aria-label="${esc(n.name)}">
    <div class="mapasidetop">
      <span class="mapstate t-${tone}"><span class="mapdot" aria-hidden="true"></span>${esc(n.state)}</span>
      <button class="mapclose" data-aside-close aria-label="Close the details">&times;</button>
    </div>
    <h3 class="mapasidename">${esc(n.name)}</h3>
    ${n.sub ? `<p class="m mapasidesub">${esc(n.sub)}</p>` : ''}
    ${
      links.length === 0
        ? `<p class="m mapnone">Nothing connects to this yet.</p>`
        : `<ul class="maplinks">${links
            .map(
              (l) => `<li${l.e.derived === true ? ' class="guess"' : ''}>
        <span class="mapverb">${esc(String(l.e.verb).replace(/_/g, ' '))}</span>
        ${esc(name(l.other))}
        ${l.e.derived === true ? `<span class="m mapwhy">${esc(l.e.because ?? 'worked out, not recorded')}</span>` : ''}
      </li>`,
            )
            .join('')}</ul>`
    }
    ${
      n.kind === 'service'
        ? /*
             Who can read it, said rather than drawn.

             Grant asked to connect services to agents. In this office a source
             is attached to the PROJECT and every agent working on that project
             reads it through the same tool permissions — there is no per-agent
             grant to draw, and a line implying one would be the false
             implication he warned about in the same paragraph. So the panel
             states the real rule in one sentence, which is both true and more
             informative than a line.
          */
          `<p class="m mapnote">Every agent on this project can read this. Access is
           granted to the project, not to one person.</p>`
        : ''
    }
    <div class="mapdo">${doorsFor(n)}</div>
  </aside>`
}

/**
 * The real door out of the panel, per kind.
 *
 * Grant: *"Items should open real tasks and documents"* and *"Preserve the
 * ability to edit individual tasks and documents. The dashboard should make
 * those capabilities easier to discover and reach."* Every button here goes to
 * a screen that already exists and already works — the map's job is to be the
 * shortest way to it, not a second implementation of it.
 */
function doorsFor(n) {
  if (n.kind === 'agent') {
    return `<button class="btn small" data-map-go="team" data-map-name="${esc(n.ref)}">See their work</button>
            <button class="btn small quiet" data-map-go="ask" data-map-name="${esc(n.ref)}">Ask them something</button>`
  }
  if (n.kind === 'service' || n.kind === 'reference') {
    return `<button class="btn small" data-map-go="sources" data-map-name="${esc(n.name)}">Manage this source</button>
            ${n.url ? `<a class="btn small quiet" href="${esc(n.url)}" target="_blank" rel="noopener">Open it</a>` : ''}`
  }
  if (n.kind === 'task') {
    return `<button class="btn small" data-map-go="task" data-map-name="${esc(n.name)}">Open in Tasks</button>`
  }
  /*
    By NAME, not by the node's id.

    The map's document ids come from `public.documents`; the page's own document
    list is positional and carries no id at all. Matching on the id would have
    been a button that resolves, looks right, finds nothing and quietly lands on
    the tab — which is the dead-control shape this repository keeps finding. The
    title is the one field both shapes actually have, and when it does not match
    the handler says so by taking you to the list rather than pretending.
  */
  return `<button class="btn small" data-map-go="doc" data-map-name="${esc(n.name)}">Open the document</button>`
}
