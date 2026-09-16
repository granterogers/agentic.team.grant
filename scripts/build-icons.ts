/**
 * Build the project icon sprite from lucide-static (#221).
 *
 *   npx tsx scripts/build-icons.ts /path/to/lucide-static/package
 *
 * Grant asked for "a reputable open-source SVG icon library rather than
 * manually creating hundreds of icons", covering business, finance, health,
 * technology, AI, research, education, travel, property, communications,
 * creative work, documents, people, science and engineering.
 *
 * ## Why a curated subset rather than all of it
 *
 * lucide-static ships 2,102 icons and a ready-made sprite at 511KB. That is
 * too much to hand a phone for a picker most sessions never open, and it is
 * also more than he asked for: 300-500 was the number, chosen so the picker is
 * browsable rather than a search-only wall.
 *
 * So this selects by DOMAIN, from lucide's own `tags.json` plus the icon name,
 * and writes the result to `web/studio/vendor/icons.svg` with a matching
 * `icons.json` carrying the search terms. Both are committed - there is no
 * build step at serve time (ADR-0002, ADR-0011) and there must not be one.
 *
 * ## Why this is a script and still counts
 *
 * CLAUDE.md: a capability that exists only as a script an agent runs is a
 * capability Grant does not have. The CAPABILITY here is choosing a project's
 * icon, and that lives in the product. This script only regenerates the
 * library, which is the thing he explicitly did not want done by hand.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = process.argv[2]
if (pkg === undefined) {
  console.error('usage: npx tsx scripts/build-icons.ts <lucide-static package dir>')
  process.exit(2)
}

/*
  The domains, in Grant's words, each with the terms that select for it.

  Written as data rather than as a list of icon names for the reason 0366 put
  the breadth dimensions in a table: a list of names is a thing only I can
  extend, and the next domain he wants is one line here rather than an
  afternoon of picking.
*/
const DOMAINS: Readonly<Record<string, readonly string[]>> = {
  business: [
    'briefcase',
    'building',
    'store',
    'handshake',
    'target',
    'presentation',
    'chart',
    'trend',
    'badge',
    'award',
    'crown',
    'gem',
  ],
  finance: [
    'coins',
    'banknote',
    'wallet',
    'credit-card',
    'receipt',
    'percent',
    'calculator',
    'piggy',
    'landmark',
    'dollar',
    'euro',
    'pound',
    'invoice',
  ],
  health: [
    'heart',
    'activity',
    'pill',
    'stethoscope',
    'syringe',
    'cross',
    'brain',
    'bone',
    'dumbbell',
    'apple',
    'leaf',
  ],
  technology: [
    'cpu',
    'server',
    'database',
    'code',
    'terminal',
    'binary',
    'chip',
    'circuit',
    'cloud',
    'wifi',
    'plug',
    'monitor',
    'laptop',
    'smartphone',
    'keyboard',
    'mouse',
    'hard-drive',
    'usb',
    'bug',
    'git',
  ],
  ai: ['bot', 'sparkles', 'wand', 'atom', 'network', 'brain-circuit', 'scan'],
  research: [
    'search',
    'microscope',
    'telescope',
    'flask',
    'test-tube',
    'beaker',
    'lightbulb',
    'compass',
    'map',
    'radar',
  ],
  education: ['book', 'graduation', 'school', 'library', 'pencil', 'notebook', 'backpack', 'ruler'],
  travel: [
    'plane',
    'train',
    'car',
    'bus',
    'bike',
    'ship',
    'anchor',
    'luggage',
    'ticket',
    'globe',
    'palmtree',
    'tent',
    'mountain',
  ],
  property: [
    'home',
    'house',
    'key',
    'door',
    'warehouse',
    'factory',
    'hotel',
    'fence',
    'hammer',
    'blocks',
  ],
  communications: [
    'mail',
    'message',
    'phone',
    'send',
    'megaphone',
    'radio',
    'rss',
    'share',
    'at-sign',
    'inbox',
    'bell',
    'speech',
  ],
  creative: [
    'palette',
    'brush',
    'pen',
    'camera',
    'image',
    'film',
    'music',
    'mic',
    'headphones',
    'scissors',
    'shapes',
    'frame',
    'layers',
    'aperture',
  ],
  documents: [
    'file',
    'folder',
    'clipboard',
    'archive',
    'paperclip',
    'stamp',
    'signature',
    'scroll',
    'newspaper',
  ],
  people: ['user', 'users', 'contact', 'smile', 'baby', 'accessibility', 'group', 'person'],
  science: [
    'orbit',
    'dna',
    'magnet',
    'thermometer',
    'waves',
    'sun',
    'moon',
    'droplet',
    'wind',
    'sprout',
    'tree',
    'bird',
    'fish',
  ],
  engineering: [
    'wrench',
    'cog',
    'settings',
    'drill',
    'ruler',
    'construction',
    'crane',
    'forklift',
    'gauge',
    'pipette',
    'lever',
  ],
  time: ['calendar', 'clock', 'timer', 'hourglass', 'alarm', 'watch'],
}

/*
  Selection.

  A tag match is the primary signal - lucide curates those - and the icon NAME
  is the fallback, because plenty of obviously-right icons carry no tag at all.
  Matching on a whole word inside a hyphenated name rather than a substring:
  "car" must not pull in "cards", "carrot" and "caravan", which the first run
  of this did, and the result was a business category full of vegetables.
*/
const tags = JSON.parse(readFileSync(join(pkg, 'tags.json'), 'utf8')) as Record<string, string[]>
const names = readdirSync(join(pkg, 'icons'))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.replace(/\.svg$/, ''))

/*
  Per domain, ranked, and capped.

  The first run took every tag match and produced 1,222 icons in a 435KB
  sprite - two and a half times what Grant asked for, and 242 of them under
  "technology" because lucide tags a great many things `computer`. He named
  300-500 deliberately: a picker you can BROWSE, not a search-only wall.

  So a name match outranks a tag match, because an icon called `briefcase` is
  about business in a way that an icon merely TAGGED business is not, and each
  domain keeps its best PER_DOMAIN. The cap is what stops one generously-tagged
  domain eating the budget.
*/
const PER_DOMAIN = 30

/*
  Variants, rejected as a PROPERTY rather than as a list of names.

  The ranked run produced `badge-alert`, `badge-help`, `badge-minus`,
  `badge-x`, `bot-off`, `credit-card-x`, `user-cog-2` and a great many more.
  lucide ships a state variant of nearly everything - the little plus, cross,
  tick or slash in the corner - and none of them is a project IDENTITY. A
  project is not "briefcase, but crossed out".

  Two shapes, both structural, so the next state lucide invents is covered
  without editing a list:

    - a modifier suffix: -off, -x, -plus, -minus, -check, -alert, -help,
      -info, -up, -down, -left, -right, -open, -closed, -search, -question;
    - a numbered sibling: anything ending -2, -3, -4, which lucide uses for
      "the same thing again, differently".

  The base icon is not excluded by either, which is the point: `bot` stays and
  `bot-off` goes.
*/
const MODIFIER =
  /-(?:off|x|plus|minus|check|alert|help|info|up|down|left|right|open|closed|search|question|\d+)$/

/*
  And the containers. `file-cog`, `folder-key`, `circle-user`, `square-user`
  are the SAME glyph inside a box, which reads as a document or a button
  rather than as a subject - so the wrapper is what the eye gets first and
  every domain fills up with boxes. Kept only when the base is not itself in
  the library, which is how `file-scan` survives and `folder-cog` does not.
*/
const WRAPPED = /^(?:file|folder|circle|square|columns|badge)-(.+)$/
const wanted = new Map<string, { domain: string; terms: string[] }>()
for (const [domain, terms] of Object.entries(DOMAINS)) {
  const scored: { name: string; rank: number; terms: string[] }[] = []
  for (const name of names) {
    if (wanted.has(name)) continue
    const parts = name.split('-')
    const t = tags[name] ?? []
    const byName = terms.some((term) =>
      term.includes('-') ? name.includes(term) : parts.includes(term),
    )
    const byTag = terms.some((term) => t.some((x) => x.split(/[\s-]+/).includes(term)))
    if (!byName && !byTag) continue
    if (MODIFIER.test(name)) continue
    const inner = WRAPPED.exec(name)?.[1]
    if (inner !== undefined && names.includes(inner)) continue
    scored.push({
      name,
      // A name match first; then the shorter name, because `home` is the
      // icon for a house and `home-plug` is not.
      rank: (byName ? 0 : 1000) + name.length,
      terms: [...new Set([...parts, ...t])],
    })
  }
  /*
    Name matches are taken whole; TAG matches only top up, and only a few.

    Filling each domain to thirty from tag matches is what put `chess-king`
    under engineering, `mouth` and `ear` under people and `grid-2x2` under
    property. lucide's tags are generous by design - they exist to make a
    SEARCH find things, and a search is allowed a loose net where a browsable
    gallery is not.

    So the cap is a ceiling and not a quota. A domain with eleven precise
    icons gets eleven, which is a better page than eleven plus nineteen
    puzzles.
  */
  const TAG_TOPUP = 6
  const byRank = scored.sort((a, b) => a.rank - b.rank)
  const exact = byRank.filter((s) => s.rank < 1000).slice(0, PER_DOMAIN)
  const loose = byRank
    .filter((s) => s.rank >= 1000)
    .slice(0, Math.min(TAG_TOPUP, PER_DOMAIN - exact.length))
  for (const s of [...exact, ...loose]) {
    wanted.set(s.name, { domain, terms: s.terms })
  }
}

const picked = [...wanted.keys()].sort()
console.log(`${String(picked.length)} icons selected from ${String(names.length)}`)

/*
  The library, as an ES module rather than a sprite.

  A sprite needs `<use href="#id">` and therefore needs the symbols IN the
  document before anything referencing them paints — so it has to be injected
  at boot, which puts 169KB in front of the first pixel on a phone. A module
  can be imported LAZILY, the way pdf.js is: the thirty hand-drawn marks in
  `icons.js` cover the first paint and the library arrives when somebody opens
  the picker or a project actually uses one of its icons.

  Path markup rather than parsed geometry, because `icons.js` already composes
  the wrapper - stroke width, caps, joins, currentColor - and a second opinion
  about those is how a grid of icons stops looking like a set.
*/
const body = (name: string): string =>
  readFileSync(join(pkg, 'icons', `${name}.svg`), 'utf8')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

const lines = picked.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(body(name))},`)

/*
  The index the picker browses and searches, in the same file.

  One file, because two would be two fetches for one feature and the terms are
  useless without the geometry. Kept as a separate export so a caller that only
  draws icons never walks it.
*/
const index = picked.map((name) => ({
  id: name,
  d: wanted.get(name)?.domain ?? '',
  t: (wanted.get(name)?.terms ?? []).filter((x) => x !== '').slice(0, 8),
}))

const module_ = [
  '/*',
  '  451 icons from lucide-static v1.46.0, ISC licence (#221).',
  '',
  '  GENERATED by scripts/build-icons.ts — do not edit by hand. Grant asked for',
  '  "a reputable open-source SVG icon library rather than manually creating',
  '  hundreds of icons", and editing the output is the same mistake one step',
  '  later. To change the selection, change the DOMAINS table in that script',
  '  and run it again.',
  '',
  '  Imported lazily. See web/studio/icons.js for why.',
  '*/',
  '',
  '/** Icon id to its inner SVG markup. The wrapper is composed by icons.js. */',
  'export const LUCIDE = {',
  ...lines,
  '}',
  '',
  '/** What the picker browses: id, domain, and the terms it searches. */',
  `export const INDEX = ${JSON.stringify(index)}`,
  '',
].join('\n')

writeFileSync('web/studio/vendor/icons-library.js', module_)

const byDomain = new Map<string, number>()
for (const i of index) byDomain.set(i.d, (byDomain.get(i.d) ?? 0) + 1)
for (const [d, n] of [...byDomain].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${d.padEnd(16)} ${String(n)}`)
}
console.log(
  `\nwrote web/studio/vendor/icons-library.js (${String(Math.round(module_.length / 1024))}KB)`,
)
