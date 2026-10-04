/*
  PROJECT-WIDE FIND: the providers.

  Grant, 4 October 2026: search as many real stores as can be searched safely -
  documents, tasks, chats, Post-its, calendar events, saved web pages, sources,
  agent research - and never fabricate a result. Each store is a PROVIDER: a
  small function from a query to hits. The page's search and the command
  palette both ask the same list, so the next store somebody wires in appears in
  both and there is no second place that knows what can be searched.

  A hit is { kind, project, title, excerpt, who, when, to, open? }. `to` is
  where the press goes; `open` names the record to open once there.

  What is searched is what this browser already holds (the studio payload, the
  calendar's loaded window, the Post-its, the loaded conversation) plus whatever
  the office adds through the `project_search` section. It is not a claim about
  what exists anywhere else, and the page says so.
*/

import * as grid from './layout.js'

const at = (p) => p

const norm = (...bits) =>
  bits
    .filter((b) => b !== undefined && b !== null && b !== '')
    .join(' ')
    .toLowerCase()

/** Is every word of the query in the haystack. */
export const matches = (q, ...bits) => {
  const words = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  const hay = norm(...bits)
  return words.every((w) => hay.includes(w))
}

const snippet = (text, q, n = 120) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const at0 = t.toLowerCase().indexOf(String(q).trim().toLowerCase().split(/\s+/)[0] ?? '')
  const from = Math.max(0, (at0 < 0 ? 0 : at0) - 30)
  return `${from > 0 ? '…' : ''}${t.slice(from, from + n)}…`
}

/** The providers that are not already in the page's own search. Add one here and it is searched everywhere. */
export const PROVIDERS = [
  {
    id: 'notes',
    kind: 'Note',
    group: 'Notes',
    search: (q, env) =>
      env.projects().flatMap((p) =>
        grid
          .doc(p.slug)
          .postits.filter((n) => matches(q, n.text))
          .map((n) => ({
            kind: 'Note',
            project: p.name,
            slug: p.slug,
            title: snippet(n.text, q, 70),
            excerpt: 'A Post-it on the project page',
            who: '',
            when: '',
            to: at(`/p/${p.slug}`),
          })),
      ),
  },
  {
    id: 'events',
    kind: 'Event',
    group: 'Events',
    search: (q, env) =>
      env.projects().flatMap((p) =>
        (env.knownEvents?.(p.slug) ?? [])
          .filter((e) => matches(q, e.title, e.location, e.notes))
          .map((e) => ({
            kind: 'Event',
            project: p.name,
            slug: p.slug,
            title: e.title,
            excerpt: [e.location, snippet(e.notes, q, 80)].filter(Boolean).join(' · '),
            who: '',
            when: e.startDay,
            to: at(`/p/${p.slug}/schedule`),
            open: { type: 'event', id: e.id, slug: p.slug },
          })),
      ),
  },
  {
    id: 'chats',
    kind: 'Chat',
    group: 'Chats',
    search: (q, env) =>
      env.projects().flatMap((p) =>
        (env.chatFor?.(p.slug) ?? [])
          .filter((m) => matches(q, m.text))
          .slice(0, 5)
          .map((m) => ({
            kind: 'Chat',
            project: p.name,
            slug: p.slug,
            title: snippet(m.text, q, 90),
            excerpt: '',
            who: m.who ?? '',
            when: m.when ?? '',
            to: at(`/p/${p.slug}/chat`),
          })),
      ),
  },
]

/** Every extra hit for a query, filtered by kind and project. */
export const extra = (q, kind, only, env) => {
  if (String(q).trim() === '') return []
  const out = []
  for (const pr of PROVIDERS) {
    if (kind !== 'Everything' && kind !== `${pr.kind}s` && kind !== pr.kind) continue
    for (const h of pr.search(q, env)) {
      if (only !== null && h.slug !== only) continue
      out.push(h)
    }
  }
  return out
}

/** The kinds the page's filter chips offer for these providers. */
export const KINDS = PROVIDERS.map((p) => `${p.kind}s`)
