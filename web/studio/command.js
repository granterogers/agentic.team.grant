/*
  One bar for everything (#40 idea 1).

  Grant wants the whole product to cohere and to be *"easy to use, easy to
  expand"*. A command bar is the cheapest way to get both at once: it is the
  fastest route to anything, and every feature added later becomes reachable
  through it without anyone adding a button.

  ## The one idea that makes it more than a search box

  If what you typed matches nothing, that is not a failure — it is an
  instruction. *"draft the follow-up email for Priya"* matches no document and
  no project, and it is a perfectly good thing to say to the team. So the last
  result is always **Ask the team**, carrying whatever you typed. The bar
  therefore has no dead end, which is the property that lets you reach for it
  without first deciding whether you are navigating or asking.

  ## Ranking

  Not fuzzy matching. Fuzzy matching is how a command bar puts the wrong thing
  first and teaches you to stop trusting it. This is:

    exact title            1000
    starts with the query   700
    word-start match        500
    contains                300
    subsequence            100   (the fuzzy case, deliberately last)

  plus a small kind weight so that with everything else equal a project beats a
  document, and a recency nudge for the project you are in. Ties break by
  shorter title, because a shorter title containing the query is more likely to
  BE the thing.
*/

const KIND_WEIGHT = {
  project: 60,
  section: 45,
  setting: 30,
  document: 25,
  contact: 25,
  task: 20,
  agent: 20,
}

/** Where a query matches a candidate, and how strongly. 0 means it does not. */
export function score(query, text) {
  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()
  if (q === '') return 1
  if (t === q) return 1000
  if (t.startsWith(q)) return 700
  // A word start: "vision" should find "Creating Client Vision" strongly.
  for (const word of t.split(/[\s—·\-/(),.]+/)) {
    if (word.startsWith(q)) return 500
  }
  if (t.includes(q)) return 300
  // Subsequence, last and lowest: "wscv" finds "WS02 Creating Vision", but
  // never above something that actually contains what you typed.
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i === q.length) return 100
  }
  return 0
}

/**
 * Everything reachable, as a flat list.
 *
 * Built fresh each keystroke rather than cached, because the alternative is a
 * cache that goes stale the first time a document is approved out of the
 * in-tray and nobody notices for a week.
 */
export function candidates({ projects, project, sections, settings, crew, docsFor }) {
  const out = []

  for (const p of projects) {
    out.push({
      kind: 'project', id: p.slug, title: p.name, hint: p.purpose, hue: p.hue,
      go: { view: 'project', project: p.slug },
    })
  }

  if (project) {
    for (const s of sections) {
      out.push({
        kind: 'section', id: s.id, title: s.name, hint: `in ${project.name}`,
        go: { view: 'project', project: project.slug, tab: s.id },
      })
    }
    for (const [i, d] of docsFor(project).entries()) {
      out.push({
        kind: 'document', id: String(i), title: d.title, hint: d.origin,
        go: { view: 'project', project: project.slug, tab: 'documents', doc: i },
      })
    }
    for (const [i, c] of project.contacts.entries()) {
      out.push({
        kind: 'contact', id: String(i), title: c.name, hint: c.role, hue: c.hue,
        go: { view: 'project', project: project.slug, tab: 'contacts', contact: i },
      })
    }
    for (const [i, t] of project.tasks.entries()) {
      out.push({
        kind: 'task', id: String(i), title: t.title, hint: t.note ?? t.due ?? 'Task',
        go: { view: 'project', project: project.slug, tab: 'tasks' },
      })
    }
  }

  for (const c of crew) {
    out.push({
      kind: 'agent', id: c.slug, title: c.name, hint: c.role, hue: c.hue,
      go: { view: 'project', tab: 'team', sub: 'board' },
    })
  }

  for (const s of settings) {
    out.push({
      kind: 'setting', id: s.id, title: s.name, hint: 'Settings',
      go: { settings: s.id },
    })
  }

  /*
    The global views, and exactly the ones the rail has (§57, §59).

    This offered a "Desk — projects where you left them" that #77 removed:
    `view: 'desk'` matches no branch in `drawShell`, so it fell through to the
    home board — a row that named a screen that no longer exists and quietly
    took you somewhere else. Nothing could see it, either: `verify:wired` reads
    attributes off rendered controls and these rows are built from data.

    And it was missing the two the rail DOES have. Searching "tasks" from the
    home board found nothing but the Ask row, on a product whose left rail has
    a Tasks entry with a count on it.

    The wording is the rail's wording, deliberately — #222 is about one name per
    thing, and a command bar that calls it something else is a second name.
  */
  out.push({ kind: 'section', id: 'portfolio', title: 'All projects', hint: 'Home', go: { view: 'portfolio' } })
  out.push({
    kind: 'section', id: 'tasks', title: 'Tasks',
    hint: 'Everything on your plate, across every project', go: { view: 'tasks' },
  })
  out.push({
    kind: 'section', id: 'lately', title: 'Recent activity',
    hint: 'What the office has done', go: { view: 'lately' },
  })

  return out
}

export function search(query, all, limit = 8) {
  const scored = []
  for (const c of all) {
    const s = score(query, c.title)
    if (s === 0) continue
    scored.push({ ...c, _s: s + (KIND_WEIGHT[c.kind] ?? 0) })
  }
  scored.sort((a, b) => b._s - a._s || a.title.length - b.title.length)
  return scored.slice(0, limit)
}

export const KIND_NAME = {
  project: 'Project',
  section: 'Go to',
  setting: 'Settings',
  document: 'Document',
  contact: 'Person',
  task: 'Task',
  agent: 'Team',
  /*
    The two that come from the office rather than from the page (#37).

    Named for where the match WAS rather than for what the thing is: a row
    labelled "Document" matched its title, and one labelled "Inside" matched
    its words. The distinction is the whole reason the second group exists, and
    a reader who cannot see it will wonder why the same document is listed
    twice.
  */
  inside: 'Inside',
  answer: 'Answer',
}
