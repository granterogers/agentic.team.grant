/**
 * The command bar can only offer you somewhere you can actually go.
 *
 * §57 and §59. The bar's rows are built from DATA, not from rendered controls,
 * so `verify:wired` — which walks twenty-one screens collecting `data-*`
 * attributes off real buttons — cannot see them at all. A row naming a screen
 * that no longer exists is invisible to every audit this repository has.
 *
 * It had one. #77 removed the desk; `candidates` went on offering
 * *"Desk — projects where you left them"*, whose `view: 'desk'` matches no
 * branch in `drawShell` and therefore fell through to the home board. Pressing
 * it took you somewhere real while naming somewhere that was gone, which is
 * worse than a dead control: a dead control teaches you it is dead.
 *
 * So the property, rather than a list of the rows that exist today: every view
 * the bar can send you to is a view the shell knows how to draw, and every
 * global view the RAIL offers is reachable from the bar. Both directions,
 * because the bug was one of each.
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — the studio is hand-written ES modules with no types, by design (ADR-0002).
import { candidates } from '../../web/studio/command.js'

const APP = await readFile('web/studio/app.js', 'utf8')

/** The views `drawShell` actually has a branch for, read from the source. */
const drawable = (): Set<string> => {
  const shell = APP.slice(
    APP.indexOf('function drawShell()'),
    APP.indexOf('function drawShell()') + 900,
  )
  const found = new Set<string>()
  for (const m of shell.matchAll(/state\.view === '([a-z-]+)'/g)) found.add(m[1] as string)
  // The last ternary has no test: it is the fallback, and it is the home board.
  found.add('portfolio')
  return found
}

/** The global views the left rail offers, read the same way. */
const inTheRail = (): Set<string> => {
  const rail = APP.slice(APP.indexOf('function rail()'), APP.indexOf('function commandBar()'))
  const found = new Set<string>()
  for (const m of rail.matchAll(/data-go="([a-z-]+)"/g)) found.add(m[1] as string)
  return found
}

const rows = () =>
  candidates({
    projects: [{ slug: 'a', name: 'A', purpose: 'p', hue: 'moss', contacts: [], tasks: [] }],
    project: null,
    sections: [{ id: 'overview', name: 'Overview' }],
    settings: [{ id: 'team', name: 'Team' }],
    crew: [{ slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', hue: 'moss' }],
    docsFor: () => [],
  }) as { kind: string; title: string; go?: { view?: string } }[]

describe('the command bar cannot lie about where a row goes', () => {
  it('never offers a view the shell has no branch for', () => {
    const can = drawable()
    const offered = new Set(
      rows()
        .map((r) => r.go?.view)
        .filter((v): v is string => typeof v === 'string'),
    )
    const impossible = [...offered].filter((v) => !can.has(v))
    expect(impossible, `drawShell can draw: ${[...can].join(', ')}`).toEqual([])
  })

  it('offers every global view the rail offers', () => {
    /*
      The other direction. Searching "tasks" from the home board found nothing
      but the Ask row, while the rail had a Tasks entry with a count on it —
      the bar and the rail disagreeing about what the product contains.

      `portfolio` is excluded because the wordmark and the home entry both use
      it and it is the fallback anyway; what matters is the ones you could
      otherwise only reach by aiming at the rail.
    */
    const offered = new Set(rows().map((r) => r.go?.view))
    const missing = [...inTheRail()].filter((v) => v !== 'portfolio' && !offered.has(v))
    expect(missing).toEqual([])
  })

  it('names them the way the rail names them', () => {
    // #222: one name per thing. A bar that calls it something else is a second
    // name, which is the whole complaint that issue was filed about.
    const byView = new Map(rows().map((r) => [r.go?.view, r.title]))
    expect(byView.get('lately')).toBe('Recent activity')
    expect(byView.get('tasks')).toBe('Tasks')
  })
})
