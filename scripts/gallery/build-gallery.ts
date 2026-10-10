// biome-ignore-all format: a label table, one surface per line reads better than the formatter's wrapping
/**
 * Builds docs/integration/final-visual-gallery from raw captures (local, no production):
 *
 *   npx tsx scripts/gallery/build-gallery.ts <raw-dir> <commit-sha>
 *
 * <raw-dir> holds the output of the three capture commands in the gallery README (populated/, gx/, look-*, lab/, resp/). The script
 * only COPIES and LABELS: it never edits pixels. Every file keeps the bytes the browser wrote; thumbnails are made separately (README).
 * It writes screenshots/, manifest.json, index.html and the inventory part of README.md's machine tables.
 */
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'

const RAW = process.argv[2] ?? '.out/g'
const SHA = process.argv[3] ?? 'unknown'
const OUT = 'docs/integration/final-visual-gallery'
await rm(`${OUT}/screenshots`, { recursive: true, force: true })
await mkdir(`${OUT}/screenshots`, { recursive: true })

type Meta = { area: string; title: string; state: string }
const AREAS = ['Dashboard and project workspace', 'Menus and navigation', 'Chat', 'My Tasks and Search', 'Schedule', 'Maximised modules', 'Records and editors', 'Settings', 'Looks and palettes', 'Dialogs and notifications', 'Sign-in and onboarding', 'Responsive extras', 'Empty and first-run']
const A = (i: number): string => AREAS[i] as string

const POP: Record<string, Meta> = {
  'board-busy-project': { area: A(0), title: 'Project board, busy project (140 to-dos, 36 documents, 28 contacts)', state: 'normal' },
  'board-long-project-name': { area: A(0), title: 'Project board, 100-character project name', state: 'normal' },
  'project-menu-six-projects': { area: A(1), title: 'Burger menu / project selection (six projects, one with a 100-character name)', state: 'menu open' },
  'my-tasks-70-items': { area: A(3), title: 'My Tasks, 70 items with repeating reminders', state: 'normal' },
  search: { area: A(3), title: 'Search page', state: 'normal' },
  'maximised-tasks': { area: A(5), title: 'To-dos, maximised (140 items)', state: 'maximised' },
  'maximised-schedule': { area: A(5), title: 'Schedule, maximised (default view)', state: 'maximised' },
  'maximised-documents': { area: A(5), title: 'Docs and Files, maximised (36 documents)', state: 'maximised' },
  'maximised-contacts': { area: A(5), title: 'Contacts, maximised (28 contacts)', state: 'maximised' },
  'maximised-activity': { area: A(5), title: 'Latest activity, maximised', state: 'maximised' },
  'chat-dock-90-messages-GENERATED': { area: A(2), title: 'Chat dock open, 90-message conversation (conversation is GENERATED, not stored by the office)', state: 'dock open' },
  'chat-keyboard-emulated': { area: A(2), title: 'Chat dock with an emulated soft keyboard (viewport shrunk; NOT iOS Safari)', state: 'dock open, keyboard emulated' },
}
const GX: Record<string, Meta> = {
  'dashboard-board': { area: A(0), title: 'Project board (the main dashboard)', state: 'normal' },
  'schedule-compact': { area: A(4), title: 'Schedule module on the board, compact', state: 'compact' },
  'schedule-maximised-day': { area: A(4), title: 'Schedule, Day view', state: 'maximised' },
  'schedule-maximised-week': { area: A(4), title: 'Schedule, Week view', state: 'maximised' },
  'schedule-maximised-month': { area: A(4), title: 'Schedule, Month view', state: 'maximised' },
  'record-task': { area: A(6), title: 'Task record sheet', state: 'record sheet' },
  'record-contact': { area: A(6), title: 'Contact record sheet', state: 'record sheet' },
  'record-document': { area: A(6), title: 'Document record / viewer', state: 'record sheet' },
  'page-menu': { area: A(1), title: 'Project three-dot (page) menu', state: 'menu open' },
  'background-picker': { area: A(1), title: 'Background picker ("How this project looks")', state: 'picker open' },
  'jump-search': { area: A(1), title: 'Jump / command overlay (Ctrl+K)', state: 'overlay open' },
  'settings-index': { area: A(7), title: 'Settings, category list', state: 'normal' },
  'settings-appearance': { area: A(7), title: 'Settings, Appearance (looks, accent colour, texture, density, glass, depth)', state: 'normal' },
  'settings-appearance-lower': { area: A(7), title: 'Settings, Appearance, scrolled to the end (display density, glass, depth)', state: 'scrolled' },
  'settings-behaviour': { area: A(7), title: 'Settings, Behaviour', state: 'normal' },
  'settings-channels': { area: A(7), title: 'Settings, Channels', state: 'normal' },
  'settings-connections': { area: A(7), title: 'Settings, Connections', state: 'normal' },
  'settings-help': { area: A(7), title: 'Settings, Help', state: 'normal' },
  'settings-memory': { area: A(7), title: 'Settings, Memory', state: 'normal' },
  'settings-models': { area: A(7), title: 'Settings, Models', state: 'normal' },
  'settings-requests': { area: A(7), title: 'Settings, Requests', state: 'normal' },
  'settings-team': { area: A(7), title: 'Settings, Team', state: 'normal' },
}
const LAB: Record<string, Meta> = {
  home: { area: A(0), title: 'Home / portfolio (stand-in office, one project)', state: 'normal' },
  'home-writer': { area: A(0), title: 'Home, signed-in writer (stand-in office)', state: 'normal' },
  activity: { area: A(3), title: 'Activity page (stand-in office)', state: 'normal' },
  'project-settings': { area: A(7), title: 'Project settings', state: 'normal' },
  'burger-menu': { area: A(1), title: 'Burger menu (stand-in office)', state: 'menu open' },
  'new-project-form': { area: A(1), title: 'New project form', state: 'form open' },
  'module-maximised-board': { area: A(5), title: 'Card table, maximised (stand-in office, example cards)', state: 'maximised' },
  'event-editor': { area: A(6), title: 'Event editor (new event)', state: 'editor open' },
  'module-tint-popover': { area: A(6), title: 'Module three-dot / tint popover', state: 'popover open' },
  'layouts-popover': { area: A(6), title: 'Layouts popover', state: 'popover open' },
  'note-focused': { area: A(6), title: 'Sticky note focused', state: 'note focused' },
  'confirm-dialog': { area: A(9), title: 'Confirmation dialog', state: 'dialog open' },
  'confirm-dialog-danger': { area: A(9), title: 'Confirmation dialog, destructive action', state: 'dialog open' },
  'ask-dialog': { area: A(9), title: 'Ask dialog (reason required)', state: 'dialog open' },
  'undo-bar': { area: A(9), title: 'Undo bar', state: 'notification' },
  'undo-bar-message': { area: A(9), title: 'Undo bar, long message', state: 'notification' },
  'undo-bar-error': { area: A(9), title: 'Undo bar, error state', state: 'notification' },
  'undo-bar-long': { area: A(9), title: 'Undo bar, very long text', state: 'notification' },
  'entry-sign-in': { area: A(10), title: 'Sign-in screen', state: 'normal' },
  'entry-create-account': { area: A(10), title: 'Create-account screen', state: 'normal' },
  'entry-signed-out-notice': { area: A(10), title: 'Signed-out notice (session refused)', state: 'normal' },
  'setup-office': { area: A(10), title: 'Set up your office (first sign-in)', state: 'normal' },
  'first-run': { area: A(12), title: 'First run: no projects yet', state: 'empty' },
  'empty-project-board': { area: A(12), title: 'Empty project board', state: 'empty' },
  'empty-tasks-maximised': { area: A(12), title: 'To-dos maximised, empty', state: 'empty, maximised' },
  'empty-schedule-maximised': { area: A(12), title: 'Schedule maximised, empty', state: 'empty, maximised' },
}
const RESP: Record<string, Meta> = {
  home: { area: A(11), title: 'Home / portfolio', state: 'normal' },
  'project-board': { area: A(11), title: 'Project board', state: 'normal' },
  'burger-menu': { area: A(11), title: 'Burger menu', state: 'menu open' },
  'settings-index': { area: A(11), title: 'Settings, category list', state: 'normal' },
  'settings-appearance': { area: A(11), title: 'Settings, Appearance', state: 'normal' },
}
const LOOKS: Record<string, string> = { silver: 'Slate & Silver', forest: 'Forest & Brass', graphite: 'Warm Graphite' }
const LOOKSURF = ['dashboard-board', 'settings-index', 'settings-appearance']
const DEV: Record<string, { vp: string; w: number; h: number; note: string }> = {
  '1440': { vp: '1440x900', w: 1440, h: 900, note: 'desktop' }, desktop1440: { vp: '1440x900', w: 1440, h: 900, note: 'desktop' },
  '390': { vp: '390x844', w: 390, h: 844, note: 'iPhone-size, Chromium touch emulation' }, phone390: { vp: '390x844', w: 390, h: 844, note: 'iPhone-size, Chromium touch emulation' },
  phone360: { vp: '360x740', w: 360, h: 740, note: 'small phone, Chromium touch emulation' }, phone430: { vp: '430x932', w: 430, h: 932, note: 'large phone, Chromium touch emulation' },
  phone390land: { vp: '844x390', w: 844, h: 390, note: 'phone landscape, Chromium touch emulation' }, tablet768: { vp: '768x1024', w: 768, h: 1024, note: 'tablet, Chromium touch emulation' },
}
const SRC_POP = 'Local replica: the real page and the real hq-api code answering from an isolated Postgres replica holding synthetic rows (140 to-dos, 36 documents, 28 contacts, 12 events, 70 personal items)'
const SRC_LAB = 'Local stand-in: the real page served locally against the lab\'s stand-in gateway (one near-empty project) or the signed-out prototype'

type Entry = { id: string; file: string; area: string; surface: string; title: string; scheme: 'light' | 'dark'; look: string; palette: string; viewport: string; device: string; state: string; source: string; sourceKind: 'local-replica' | 'local-standin'; data: string; commit: string; pair: string; status: 'captured' }
const entries: Entry[] = []
const used = new Set<string>()
const add = async (raw: string, surface: string, m: Meta, scheme: 'light' | 'dark', look: string, dev: string, kind: 'replica' | 'standin', generated = false, accent = 'blue'): Promise<void> => {
  const d = DEV[dev]
  if (d === undefined) throw new Error(`device ${dev}`)
  const name = `${m.area.toLowerCase().replace(/[^a-z]+/g, '-')}__${surface}__${kind === 'replica' ? 'replica' : 'standin'}__${d.vp}__${scheme}__${look === 'original' ? 'original' : look}-${accent === 'blue' ? 'slate' : accent}.png`
  if (used.has(name)) throw new Error(`duplicate ${name}`)
  used.add(name)
  await copyFile(raw, `${OUT}/screenshots/${name}`)
  entries.push({
    id: name.replace(/\.png$/, ''), file: `screenshots/${name}`, area: m.area, surface, title: m.title, scheme, look: look === 'original' ? 'Original' : (LOOKS[look] as string), palette: accent === 'blue' ? 'slate (accent Blue)' : 'paper (accent Violet)', viewport: d.vp, device: d.note, state: m.state,
    source: kind === 'replica' ? SRC_POP : SRC_LAB, sourceKind: kind === 'replica' ? 'local-replica' : 'local-standin', data: generated ? 'GENERATED conversation (not stored by the office)' : kind === 'replica' ? 'synthetic replica rows' : 'stand-in / prototype content', commit: SHA,
    pair: `${m.area}|${surface}|${kind}|${d.vp}|${look}`, status: 'captured',
  })
}

for (const f of (await readdir(`${RAW}/populated`)).sort()) {
  const x = /^(real|generated)-(1440|390)-(dark|light)-(.+)\.png$/.exec(f)
  if (x === null) continue
  const m = POP[x[4] as string]
  if (m !== undefined) await add(`${RAW}/populated/${f}`, x[4] as string, m, x[3] as 'dark', 'original', x[2] as string, 'replica', x[1] === 'generated')
}
for (const f of (await readdir(`${RAW}/gx`)).sort()) {
  const x = /^real-(1440|390)-(dark|light)-gx-(.+)\.png$/.exec(f)
  if (x === null) continue
  const m = GX[x[3] as string]
  if (m !== undefined) await add(`${RAW}/gx/${f}`, x[3] as string, m, x[2] as 'dark', 'original', x[1] as string, 'replica')
}
for (const look of Object.keys(LOOKS)) {
  for (const f of (await readdir(`${RAW}/look-${look}`)).sort()) {
    const x = /^real-(1440|390)-(dark|light)-gx-(.+)\.png$/.exec(f)
    if (x === null || !LOOKSURF.includes(x[3] as string)) continue
    const base = GX[x[3] as string] as Meta
    await add(`${RAW}/look-${look}/${f}`, x[3] as string, { ...base, area: A(8), title: `${base.title}, look: ${LOOKS[look]}` }, x[2] as 'dark', look, x[1] as string, 'replica')
  }
}
for (const f of (await readdir(`${RAW}/pal-paper`)).sort()) {
  const x = /^real-(1440|390)-(dark|light)-gx-(.+)\.png$/.exec(f)
  if (x === null || !['dashboard-board', 'settings-appearance'].includes(x[3] as string)) continue
  const base = GX[x[3] as string] as Meta
  await add(`${RAW}/pal-paper/${f}`, x[3] as string, { ...base, area: A(8), title: `${base.title}, accent colour Violet` }, x[2] as 'dark', 'original', x[1] as string, 'replica', false, 'violet')
}
for (const f of (await readdir(`${RAW}/lab`)).sort()) {
  const x = /^(.+)__(desktop1440|phone390)-(dark|light)-slate\.png$/.exec(f)
  if (x === null) continue
  const m = LAB[x[1] as string]
  if (m !== undefined) await add(`${RAW}/lab/${f}`, x[1] as string, m, x[3] as 'dark', 'original', x[2] as string, 'standin')
}
for (const f of (await readdir(`${RAW}/resp`)).sort()) {
  const x = /^(.+)__(phone360|phone430|tablet768|phone390land)-(dark|light)-slate\.png$/.exec(f)
  if (x === null) continue
  const m = RESP[x[1] as string]
  if (m !== undefined) await add(`${RAW}/resp/${f}`, x[1] as string, m, x[3] as 'dark', 'original', x[2] as string, 'standin')
}

const notCaptured = [
  { item: 'Real iOS Safari (any screen)', reason: 'No WebKit or iOS device in the build environment. Every "390x844" image is Chromium with touch emulation, not iOS Safari.' },
  { item: 'Real microphone, dictation and live voice in use', reason: 'No audio hardware; only the buttons and idle states are shown. Voice is covered by simulated-audio suites, not by these images.' },
  { item: 'Hosted preview signed in / Sample Office on the hosted preview', reason: 'The hosted preview cannot sign in (its API base is a placeholder); that is why this gallery exists. Every image here is a local capture.' },
  { item: 'Real Grant office data, real Google calendar, real Telegram/Slack', reason: 'Production access is forbidden for this task. Data is synthetic rows in an isolated replica.' },
  { item: 'Event editor over the populated replica', reason: 'The populated run did not open the editor (the capture failed and is not included). The editor is shown from the stand-in office instead.' },
  { item: 'Task, contact and document record sheets on the stand-in office; Attention page', reason: 'The stand-in office has no such records, and the Attention page did not open in the lab. The record sheets are shown from the populated replica.' },
  { item: 'Module tint / layouts popovers and sticky notes on a phone', reason: 'Not offered on a phone by design (arrangement controls are off there). Desktop captures included.' },
  { item: 'Full-page / long-scroll captures', reason: 'Team HQ is a fixed-viewport canvas (ADR-0072): the page itself does not scroll, lists scroll inside their module or sheet. Captures are viewport images; lists are shown through the maximised module views. Settings panes taller than a phone screen are cut at the viewport.' },
  { item: 'Operating-system push notifications', reason: 'Not part of the page. The in-page undo bar and dialogs are captured.' },
  { item: 'Palette matrix beyond Settings and the dashboard', reason: 'Other looks (Slate & Silver, Forest & Brass, Warm Graphite) are captured for the dashboard and Settings only, as asked, to avoid a needless full matrix.' },
]

await writeFile(`${OUT}/manifest.json`, `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), branch: 'integration/aesthetic-release-candidate', commit: SHA, viewportNote: 'Chromium emulation only; iOS Safari was not tested', count: entries.length, notCaptured, entries }, null, 1)}\n`)

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const keyOf = (e: Entry): string => `${e.area}|${e.surface}|${e.sourceKind}|${e.look}`
const groups = new Map<string, Entry[]>()
for (const e of entries) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e])
const byArea = new Map<string, Map<string, Entry[]>>()
for (const [k, v] of groups) {
  const area = k.split('|')[0] as string
  const m = byArea.get(area) ?? new Map<string, Entry[]>()
  m.set(k, v)
  byArea.set(area, m)
}
const slugOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const fig = (e: Entry | undefined, label: string): string => {
  if (e === undefined) return `<figure class="miss"><figcaption><b>${label}</b> NOT CAPTURED</figcaption></figure>`
  const th = e.file.replace('screenshots/', 'thumbs/').replace(/\.png$/, '.jpg')
  return `<figure><a href="${esc(e.file)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(th)}" alt="${esc(`${e.title}, ${e.scheme}, ${e.viewport}`)}" width="${e.viewport.startsWith('1440') || e.viewport.startsWith('768') || e.viewport.startsWith('844') ? 640 : 220}"></a><figcaption><b>${label}</b> · ${esc(e.viewport)} · ${esc(e.look)} / ${esc(e.palette)} · ${esc(e.state)} · ${e.sourceKind === 'local-replica' ? 'local replica' : 'local stand-in'}${e.data.startsWith('GENERATED') ? ' · GENERATED chat' : ''} · <code>${SHA.slice(0, 7)}</code> · <a href="${esc(e.file)}">full-res PNG</a></figcaption></figure>`
}
const sections: string[] = []
const nav: string[] = []
for (const area of AREAS) {
  const m = byArea.get(area)
  if (m === undefined) continue
  nav.push(`<a href="#${slugOf(area)}">${esc(area)}</a>`)
  const rows: string[] = []
  for (const [, list] of m) {
    const first = list[0] as Entry
    const vps = [...new Set(list.map((e) => e.viewport))]
    const cols = vps.map((vp) => {
      const l = list.find((e) => e.viewport === vp && e.scheme === 'light')
      const d = list.find((e) => e.viewport === vp && e.scheme === 'dark')
      const mobile = !vp.startsWith('1440')
      return `<div class="pair ${mobile ? 'mob' : 'desk'}"><h4>${esc(vp)} <small>${esc((list.find((e) => e.viewport === vp) as Entry).device)}</small></h4><div class="sbs">${fig(l, 'Light')}${fig(d, 'Dark')}</div></div>`
    })
    rows.push(`<article><h3>${esc(first.title)}</h3><p class="meta">Source: ${esc(first.source)}. ${first.data.startsWith('GENERATED') ? '<b>Conversation is generated, not stored by the office.</b>' : ''}</p>${cols.join('')}</article>`)
  }
  sections.push(`<section id="${slugOf(area)}"><h2>${esc(area)}</h2>${rows.join('')}</section>`)
}
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic Team HQ visual gallery</title>
<style>
:root{--bg:#f4f2ee;--ink:#1d2430;--mut:#5b6573;--card:#fff;--line:#d9d5cc;--acc:#2f6fb0}
@media (prefers-color-scheme:dark){:root{--bg:#141a22;--ink:#e6e9ee;--mut:#9aa5b4;--card:#1c242f;--line:#2e3948;--acc:#7ab0ea}}
:root[data-theme=light]{--bg:#f4f2ee;--ink:#1d2430;--mut:#5b6573;--card:#fff;--line:#d9d5cc;--acc:#2f6fb0}
:root[data-theme=dark]{--bg:#141a22;--ink:#e6e9ee;--mut:#9aa5b4;--card:#1c242f;--line:#2e3948;--acc:#7ab0ea}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{padding:20px 16px 8px;max-width:1500px;margin:auto}
h1{font-size:22px;margin:0 0 6px}h2{font-size:20px;margin:36px 0 8px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{font-size:16px;margin:0 0 4px}h4{font-size:14px;margin:12px 0 6px}
main{max-width:1500px;margin:auto;padding:0 16px 60px}
nav{position:sticky;top:0;background:var(--bg);padding:8px 16px;border-bottom:1px solid var(--line);z-index:5;display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center}
nav a,.tog button{color:var(--acc);font-size:13px}
.tog button{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 10px;cursor:pointer;min-height:32px}
.tog button[aria-pressed=true]{background:var(--acc);color:var(--bg)}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:12px 0}
.meta{color:var(--mut);font-size:12.5px;margin:0 0 6px}small{color:var(--mut);font-weight:400}
.sbs{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0;max-width:100%}figure img{display:block;max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#888}
figcaption{font-size:12px;color:var(--mut);margin-top:4px;max-width:640px}.miss{border:1px dashed var(--line);padding:8px;border-radius:6px}
body.only-desk .mob,body.only-mob .desk{display:none}
table{border-collapse:collapse;font-size:13px}td,th{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
</style></head><body>
<nav aria-label="Gallery index"><strong>Index</strong>${nav.join('')}<a href="#not-captured">NOT CAPTURED</a>
<span class="tog" role="group" aria-label="Show"><button type="button" data-f="all" aria-pressed="true">All sizes</button><button type="button" data-f="only-desk" aria-pressed="false">Desktop 1440</button><button type="button" data-f="only-mob" aria-pressed="false">Phone and tablet sizes</button></span></nav>
<header><h1>Agentic Team HQ: visual review gallery</h1>
<p class="meta">Branch <code>integration/aesthetic-release-candidate</code> at commit <code>${SHA}</code>. Genuine Chromium screenshots of the current page code, unedited. Every pair shows the same screen, data, size and state in Light and Dark. Phone-size images are Chromium touch emulation, <b>not iOS Safari</b>. Source is stated on every card: <i>local replica</i> (real page and gateway code over synthetic rows) or <i>local stand-in</i> (lab gateway, near-empty office). Click an image for the full-resolution PNG. ${entries.length} images; see <a href="README.md">README.md</a> and <a href="manifest.json">manifest.json</a>.</p></header>
<main>${sections.join('\n')}
<section id="not-captured"><h2>NOT CAPTURED</h2><table><tr><th>Item</th><th>Reason</th></tr>${notCaptured.map((n) => `<tr><td>${esc(n.item)}</td><td>${esc(n.reason)}</td></tr>`).join('')}</table></section></main>
<script>document.querySelectorAll('.tog button').forEach(function(b){b.addEventListener('click',function(){document.body.className=b.dataset.f==='all'?'':b.dataset.f;document.querySelectorAll('.tog button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')})})})</script>
</body></html>
`
await writeFile(`${OUT}/index.html`, html)
console.log(`gallery: ${entries.length} images, ${notCaptured.length} NOT CAPTURED items`)
