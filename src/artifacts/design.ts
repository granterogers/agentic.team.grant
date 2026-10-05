/**
 * The design of a report, decided by rule - not drawn by a model.
 *
 * ## The split
 *
 * A model is good at EDITORIAL judgement (what leads, what is a table, what is a chart) and the draft step already asks
 * it for that. It is the wrong thing to ask to choose a margin, and the rendering path must never depend on one: the
 * same structured content and the same choices produce the same bytes. So the design is a small, closed set of options
 * the renderer can actually draw:
 *
 *   - `titlePage`: `standard` (plain, type on paper) or `band` (a field of the primary colour behind the title)
 *   - `density`: `comfortable` or `compact` (tighter leading for a long document)
 *   - `charts`: keep the chart blocks, or drop the ones that are decoration
 *
 * `designBrief` chooses among them from the house style and the SHAPE of the content. `readDesignProposal` accepts a
 * model's suggestion only where it names a supported value; everything else is refused by name, and a person's house
 * style outranks a proposal, because a style is what somebody said and a proposal is a guess.
 *
 * Pure: no database, no clock, no model.
 */

import type { Block } from './report.ts'
import type { StyleProfile } from './style.ts'

export const TITLE_PAGE_OPTIONS = ['standard', 'band'] as const
export const DENSITY_OPTIONS = ['comfortable', 'compact'] as const

export type TitlePageOption = (typeof TITLE_PAGE_OPTIONS)[number]
export type DensityOption = (typeof DENSITY_OPTIONS)[number]

export interface DesignChoice {
  readonly titlePage: TitlePageOption
  readonly density: DensityOption
  /** Whether chart blocks stay in the document. */
  readonly charts: boolean
}

export interface Design {
  readonly choice: DesignChoice
  /** One sentence per decision, saying what decided it: the style, the proposal, or the shape of the content. */
  readonly reasons: readonly string[]
  /** What a proposal asked for that is not supported, and so was not used. */
  readonly rejected: readonly string[]
}

export interface DesignProposal {
  readonly titlePage?: TitlePageOption
  readonly density?: DensityOption
  readonly charts?: boolean
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A model's design suggestion, read defensively. Unsupported values are returned in `rejected`, never used. */
export function readDesignProposal(raw: unknown): { proposal: DesignProposal; rejected: string[] } {
  const rejected: string[] = []
  if (!isObject(raw)) return { proposal: {}, rejected }
  const out: { -readonly [K in keyof DesignProposal]: DesignProposal[K] } = {}
  const pageRaw = raw.title_page ?? raw.titlePage
  if (pageRaw !== undefined) {
    if ((TITLE_PAGE_OPTIONS as readonly unknown[]).includes(pageRaw))
      out.titlePage = pageRaw as TitlePageOption
    else
      rejected.push(
        `title_page ${JSON.stringify(pageRaw)} is not one of ${TITLE_PAGE_OPTIONS.join(', ')}`,
      )
  }
  if (raw.density !== undefined) {
    if ((DENSITY_OPTIONS as readonly unknown[]).includes(raw.density))
      out.density = raw.density as DensityOption
    else
      rejected.push(
        `density ${JSON.stringify(raw.density)} is not one of ${DENSITY_OPTIONS.join(', ')}`,
      )
  }
  if (raw.charts !== undefined) {
    if (typeof raw.charts === 'boolean') out.charts = raw.charts
    else rejected.push(`charts ${JSON.stringify(raw.charts)} is not true or false`)
  }
  for (const key of Object.keys(raw)) {
    if (!['title_page', 'titlePage', 'density', 'charts'].includes(key)) {
      rejected.push(`${key} is not something the renderer can draw`)
    }
  }
  return { proposal: out, rejected }
}

/** How much text there is, in words: the one measure of "long" the density rule uses. */
export function wordCount(blocks: readonly Block[]): number {
  let n = 0
  const add = (s: string): void => {
    n += s.split(/\s+/).filter((w) => w !== '').length
  }
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
      case 'paragraph':
        add(b.text)
        break
      case 'quote':
        add(b.text)
        break
      case 'bullets':
      case 'numbers':
        for (const i of b.items) add(i)
        break
      case 'table':
        for (const r of b.rows) for (const c of r) add(c)
        break
      default:
        break
    }
  }
  return n
}

/** Past this many words a document is set tighter, unless the style said otherwise. */
export const COMPACT_ABOVE_WORDS = 2_200
/** A report with this many blocks, or a table or chart, is a formal report and takes the band. */
export const BAND_AT_BLOCKS = 14

export function designBrief(input: {
  readonly style: StyleProfile | null | undefined
  readonly blocks: readonly Block[]
  readonly proposal?: unknown
}): Design {
  const reasons: string[] = []
  const { proposal, rejected } = readDesignProposal(input.proposal)
  const styled = input.style?.formatting ?? {}
  const blocks = input.blocks

  // Title page: the house style, then a valid proposal, then the shape of the document.
  let titlePage: TitlePageOption
  if ((TITLE_PAGE_OPTIONS as readonly string[]).includes(styled.title_page ?? '')) {
    titlePage = styled.title_page as TitlePageOption
    reasons.push(`title page ${titlePage}: the house style says so`)
  } else if (proposal.titlePage !== undefined) {
    titlePage = proposal.titlePage
    reasons.push(`title page ${titlePage}: proposed by the drafting step and supported`)
  } else {
    const formal =
      blocks.length >= BAND_AT_BLOCKS ||
      blocks.some((b) => b.kind === 'table' || b.kind === 'chart')
    titlePage = formal ? 'band' : 'standard'
    reasons.push(
      formal
        ? 'title page band: a long or data-bearing report is set as a formal one'
        : 'title page standard: a short note does not need a banner',
    )
  }

  let density: DensityOption
  if ((DENSITY_OPTIONS as readonly string[]).includes(styled.density ?? '')) {
    density = styled.density as DensityOption
    reasons.push(`density ${density}: the house style says so`)
  } else if (proposal.density !== undefined) {
    density = proposal.density
    reasons.push(`density ${density}: proposed by the drafting step and supported`)
  } else {
    const words = wordCount(blocks)
    density = words > COMPACT_ABOVE_WORDS ? 'compact' : 'comfortable'
    reasons.push(
      density === 'compact'
        ? `density compact: ${String(words)} words is long enough to set tighter`
        : 'density comfortable: it is short enough to breathe',
    )
  }

  // Charts: a chart that compares fewer than three things is decoration, whatever was proposed.
  const charts = blocks.filter((b): b is Extract<Block, { kind: 'chart' }> => b.kind === 'chart')
  let keepCharts = true
  if (charts.length === 0) {
    reasons.push('charts: none in the content')
  } else if (!charts.some((c) => c.bars.length >= 3)) {
    keepCharts = false
    reasons.push('charts dropped: none compares three or more things, so it would be decoration')
  } else if (proposal.charts === false) {
    keepCharts = false
    reasons.push('charts dropped: the drafting step asked for none')
  } else {
    reasons.push('charts kept: at least one compares three or more things')
  }

  return { choice: { charts: keepCharts, density, titlePage }, rejected, reasons }
}

/** The content with the design applied (charts dropped when the design says so). Pure; never reorders. */
export const applyDesign = (blocks: readonly Block[], choice: DesignChoice): Block[] =>
  choice.charts ? [...blocks] : blocks.filter((b) => b.kind !== 'chart')

/** The profile the renderer is handed: the house style with the design's decisions laid over its formatting. */
export const effectiveStyle = (
  style: StyleProfile | null | undefined,
  choice: DesignChoice,
): StyleProfile => ({
  ...(style ?? {}),
  formatting: {
    ...(style?.formatting ?? {}),
    density: choice.density,
    title_page: choice.titlePage,
  },
})
