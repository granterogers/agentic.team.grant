/*
  THE WEB PAGES THE TEAM HAS READ, AND WHERE EACH CAME FROM.

  Grant, 4 October 2026: a page the team found and read becomes a persistent
  project source with its provenance - the address, the title, when it was
  retrieved, the project, the agent, the research it belonged to - and when a
  report leans on it the evidence stays. The office keeps all of that (section
  `web_sources`); this draws it on the Sources surface, below the connected
  services and links, so one screen answers "where did that come from".

  It is read lazily and once per project. Signed out there is nothing to show
  and nothing is invented. An office that does not have the section yet adds
  nothing and says nothing: this is a list of what exists, not a notice.
*/

import { canWrite, read } from '../office.js'
import * as when from '../when.js'
import { esc } from './parts.js'

let redraw = null
export const init = (c) => {
  redraw = c?.render ?? null
}
const cache = new Map()

export const pagesOf = (slug) => {
  if (!canWrite()) return []
  const hit = cache.get(slug)
  if (hit === undefined) {
    cache.set(slug, { state: 'loading', pages: [] })
    read('web_sources', undefined, { project: slug })
      .then((out) => {
        cache.set(slug, Array.isArray(out?.pages) ? { state: 'ready', pages: out.pages } : { state: 'off', pages: [] })
      })
      .catch(() => {
        cache.set(slug, { state: 'off', pages: [] })
      })
      .finally(() => {
        redraw?.()
      })
    return []
  }
  return hit.pages
}

export const forget = (slug) => {
  cache.delete(slug)
}

const via = (f) => {
  if (f === null || f === undefined) return ''
  if (f.how === 'search') return `found by searching "${String(f.query ?? '')}"${f.rank ? `, result ${String(f.rank)}` : ''}`
  if (f.how === 'link') return 'reached by following a link from another page'
  return ''
}

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The section, or '' when there is nothing to say. */
export const block = (p) => {
  const pages = pagesOf(p.slug)
  if (pages.length === 0) return ''
  return `<section class="bcwebsrc" aria-label="Web pages the team has read">
    <h2 class="bcsubhead">Web pages the team has read <span class="bcsrcn">${String(pages.length)}</span></h2>
    <p class="bcpmeta bcprose">Each one was found and read by the team, never acted on. Where a report uses one, the report cites it.</p>
    <ul class="bcwebsrclist">${pages
      .map((g) => {
        const facts = [
          g.retrieved_at ? `Read ${when.precise(g.retrieved_at)}` : '',
          g.agent?.name ? `by ${g.agent.name}` : '',
          g.research_task?.label ? `for "${g.research_task.label}"` : '',
          via(g.found_via),
        ].filter(Boolean)
        const cites = g.citations?.count ?? 0
        return `<li class="bcwebitem">
          <div class="bcwebmain">
            ${g.url ? `<a class="bcwebtitle" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${esc(g.title || g.url)}</a>` : `<span class="bcwebtitle">${esc(g.title ?? 'Saved page')}</span>`}
            <span class="bcwebhost">${esc(host(g.url))}${g.kind === 'file' ? ' · file' : ''}</span>
          </div>
          <p class="bcwebfacts">${esc(facts.join(' · '))}</p>
          <p class="bcwebmeta">${g.indexed ? 'Searchable by the team' : 'Not indexed'}${cites > 0 ? ` · cited in ${String(cites)} ${cites === 1 ? 'answer' : 'answers'}` : ''}${g.screenshot?.available ? ' · screenshot kept' : ''}</p>
        </li>`
      })
      .join('')}</ul>
  </section>`
}
