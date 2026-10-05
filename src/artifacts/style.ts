/**
 * A house style, as the renderer reads it (migration 0923).
 *
 * The database stores and validates a profile (`app.style_profile_problems`); this is the other half - what the PDF
 * writer can HONOUR - and it restates the SAME vocabulary so a unit test can compare the two and they cannot drift.
 *
 * ## Honest about what it draws
 *
 * The writer sets type in the faces `metrics.ts` has widths for (the Helvetica and Times families), fills
 * rectangles and draws a PNG or JPEG logo it is HANDED as bytes (`image.ts`). A profile may carry a tone, terminology
 * and a preferred structure (the drafting prompt reads those), but the renderer applies only: palette, typography,
 * the title-page treatment and the logo. `unapplied` names what a profile asked for that this renderer did not draw
 * (a logo that was missing, too large or an unsupported format says why), so nobody believes a logo is on a page it
 * is not on.
 *
 * Nothing here ever fails a render: a profile that cannot be honoured falls back to the default, and says so.
 */

import type { Face } from './metrics.ts'
import { type Rgb, rgb } from './pdf.ts'

/** The families a report can be set in - the ones `metrics.ts` can measure. */
export const FONT_FAMILIES = ['Helvetica', 'Times'] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

export const PALETTE_KEYS = ['primary', 'accent', 'ink', 'paper', 'wash', 'rule', 'muted'] as const
export const TITLE_PAGES = ['standard', 'band'] as const

export interface StyleProfile {
  readonly palette?: Partial<Record<(typeof PALETTE_KEYS)[number], string>>
  readonly typography?: { readonly heading?: string; readonly body?: string }
  readonly logo_document_id?: string
  readonly tone?: string
  readonly terminology?: Readonly<Record<string, string>>
  readonly structure?: { readonly sections?: readonly string[] }
  readonly formatting?: { readonly title_page?: string; readonly density?: string }
  readonly chart?: { readonly series_colors?: readonly string[] }
  readonly image?: { readonly style?: string; readonly avoid?: string }
  readonly audience?: string
  readonly instructions?: string
}

/** What the layout reads. `DEFAULT_THEME` is the look every report had before profiles existed. */
export interface Theme {
  readonly ink: Rgb
  readonly ink2: Rgb
  readonly ink3: Rgb
  readonly rule: Rgb
  /** Kicker, heading rule, chart bars. */
  readonly primary: Rgb
  /** The rule under the cover field and the quotation bar. */
  readonly accent: Rgb
  readonly wash: Rgb
  readonly paper: Rgb
  readonly titlePage: 'standard' | 'band'
  readonly type: {
    readonly body: TypeSpec
    readonly caption: TypeSpec
    readonly h1: TypeSpec
    readonly h2: TypeSpec
    readonly lead: TypeSpec
    readonly quote: TypeSpec
    readonly tableCell: TypeSpec
    readonly tableHead: TypeSpec
  }
}

export interface TypeSpec {
  readonly face: Face
  readonly lead: number
  readonly size: number
}

const ACCENT = rgb(0.13, 0.35, 0.52)

export const DEFAULT_THEME: Theme = {
  accent: ACCENT,
  ink: rgb(0.09, 0.1, 0.12),
  ink2: rgb(0.36, 0.38, 0.42),
  ink3: rgb(0.55, 0.57, 0.6),
  paper: rgb(1, 1, 1),
  primary: ACCENT,
  rule: rgb(0.85, 0.86, 0.88),
  titlePage: 'standard',
  type: {
    body: { face: 'Times-Roman', lead: 15.5, size: 10.5 },
    caption: { face: 'Helvetica', lead: 12, size: 8.5 },
    h1: { face: 'Helvetica-Bold', lead: 23, size: 18 },
    h2: { face: 'Helvetica-Bold', lead: 17, size: 12.5 },
    lead: { face: 'Times-Roman', lead: 18, size: 12 },
    quote: { face: 'Times-Italic', lead: 16, size: 11 },
    tableCell: { face: 'Helvetica', lead: 13, size: 9 },
    tableHead: { face: 'Helvetica-Bold', lead: 13, size: 9 },
  },
  wash: rgb(0.96, 0.965, 0.975),
}

const HEX = /^#[0-9a-f]{6}$/i

export const parseHex = (hex: string): Rgb | null => {
  if (!HEX.test(hex)) return null
  const n = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16) / 255
  return rgb(n(1), n(3), n(5))
}

const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (c: Rgb): number =>
  0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)

/** WCAG contrast ratio, 1 to 21. */
export const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] =
    luminance(a) >= luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]
  return (hi + 0.05) / (lo + 0.05)
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  rgb(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)

const family = (name: string | undefined): FontFamily | null =>
  name !== undefined && (FONT_FAMILIES as readonly string[]).includes(name)
    ? (name as FontFamily)
    : null

const bold = (f: FontFamily): Face => (f === 'Helvetica' ? 'Helvetica-Bold' : 'Times-Bold')
const roman = (f: FontFamily): Face => (f === 'Helvetica' ? 'Helvetica' : 'Times-Roman')
const italic = (f: FontFamily): Face => (f === 'Helvetica' ? 'Helvetica-Oblique' : 'Times-Italic')

export interface ResolvedTheme {
  readonly theme: Theme
  /** What the profile asked for and this renderer did not draw, or had to refuse. Empty for the default. */
  readonly unapplied: readonly string[]
}

/**
 * The theme for a profile, or the default. Never throws.
 *
 * Text must stay readable: if the profile's ink on its paper is under 4.5:1 (WCAG AA for body text) BOTH fall back to
 * the default pair and that is recorded, because a house style that prints grey on grey is not what anybody meant.
 * The primary colour must be legible on the paper too (3:1, the large-text bar the kicker and headings clear), or it
 * is kept off the page and recorded.
 */
export function resolveTheme(
  profile: StyleProfile | null | undefined,
  assets?: { readonly logo?: unknown; readonly logoProblem?: string },
): ResolvedTheme {
  if (profile === null || profile === undefined) return { theme: DEFAULT_THEME, unapplied: [] }
  const unapplied: string[] = []
  const pal = profile.palette ?? {}
  const pick = (key: (typeof PALETTE_KEYS)[number]): Rgb | null => {
    const v = pal[key]
    if (v === undefined) return null
    const c = parseHex(v)
    if (c === null) unapplied.push(`palette.${key} (${v}) is not a colour`)
    return c
  }

  let ink = pick('ink') ?? DEFAULT_THEME.ink
  let paper = pick('paper') ?? DEFAULT_THEME.paper
  if (contrast(ink, paper) < 4.5) {
    unapplied.push('ink on paper is under 4.5:1 contrast, so the default ink and paper were kept')
    ink = DEFAULT_THEME.ink
    paper = DEFAULT_THEME.paper
  }
  let primary = pick('primary') ?? DEFAULT_THEME.primary
  if (contrast(primary, paper) < 3) {
    unapplied.push('the primary colour is under 3:1 against the paper, so the default was kept')
    primary = DEFAULT_THEME.primary
  }
  const accent = pick('accent') ?? (pick('primary') !== null ? primary : DEFAULT_THEME.accent)
  const explicitInk = pick('ink') !== null && ink !== DEFAULT_THEME.ink
  const heading = family(profile.typography?.heading) ?? 'Helvetica'
  const body = family(profile.typography?.body) ?? 'Times'
  for (const [role, name] of [
    ['heading', profile.typography?.heading],
    ['body', profile.typography?.body],
  ] as const) {
    if (name !== undefined && family(name) === null)
      unapplied.push(`typography.${role} (${name}) is not a face this renderer can set`)
  }
  const wantBand = profile.formatting?.title_page === 'band'
  if (
    profile.logo_document_id !== undefined &&
    (assets?.logo === undefined || assets.logo === null)
  )
    unapplied.push(
      `the logo was not drawn: ${assets?.logoProblem ?? 'no image was supplied to the renderer for it'}`,
    )

  const compact = profile.formatting?.density === 'compact'
  const T = compact
    ? {
        ...DEFAULT_THEME.type,
        body: { ...DEFAULT_THEME.type.body, lead: 14, size: 10 },
        lead: { ...DEFAULT_THEME.type.lead, lead: 16.5, size: 11.5 },
        quote: { ...DEFAULT_THEME.type.quote, lead: 14.5, size: 10.5 },
        tableCell: { ...DEFAULT_THEME.type.tableCell, lead: 12, size: 8.5 },
      }
    : DEFAULT_THEME.type
  const theme: Theme = {
    accent,
    ink,
    ink2: explicitInk ? mix(ink, paper, 0.35) : DEFAULT_THEME.ink2,
    ink3: explicitInk ? mix(ink, paper, 0.55) : DEFAULT_THEME.ink3,
    paper,
    primary,
    rule: pick('rule') ?? DEFAULT_THEME.rule,
    titlePage: wantBand ? 'band' : 'standard',
    type: {
      ...T,
      body: { ...T.body, face: roman(body) },
      h1: { ...T.h1, face: bold(heading) },
      h2: { ...T.h2, face: bold(heading) },
      lead: { ...T.lead, face: roman(body) },
      quote: { ...T.quote, face: italic(body) },
      tableHead: { ...T.tableHead, face: bold(heading) },
    },
    wash: pick('wash') ?? DEFAULT_THEME.wash,
  }
  return { theme, unapplied }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A profile as the database hands it back (`app.hq_style_get(...).profile`), read defensively: anything of the wrong
 * shape is dropped rather than trusted, because this is JSON from a column and the renderer must not throw on it.
 */
export function readProfile(raw: unknown): StyleProfile | null {
  if (!isObject(raw) || Object.keys(raw).length === 0) return null
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const obj = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {})
  const out: {
    -readonly [K in keyof StyleProfile]: StyleProfile[K]
  } = {}
  const palette: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj(raw.palette))) if (typeof v === 'string') palette[k] = v
  if (Object.keys(palette).length > 0) out.palette = palette
  const typography: { heading?: string; body?: string } = {}
  const heading = str(obj(raw.typography).heading)
  const body = str(obj(raw.typography).body)
  if (heading !== undefined) typography.heading = heading
  if (body !== undefined) typography.body = body
  if (Object.keys(typography).length > 0) out.typography = typography
  const formatting: { title_page?: string; density?: string } = {}
  const titlePage = str(obj(raw.formatting).title_page)
  const density = str(obj(raw.formatting).density)
  if (titlePage !== undefined) formatting.title_page = titlePage
  if (density !== undefined) formatting.density = density
  if (Object.keys(formatting).length > 0) out.formatting = formatting
  for (const key of ['logo_document_id', 'tone', 'audience', 'instructions'] as const) {
    const v = str(raw[key])
    if (v !== undefined) out[key] = v
  }
  const sections = obj(raw.structure).sections
  if (Array.isArray(sections))
    out.structure = { sections: sections.filter((x): x is string => typeof x === 'string') }
  return Object.keys(out).length === 0 ? null : out
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The resolved style for a job's project, or null. Fails OPEN: a report must still be written when the style lookup
 * cannot be, so any failure is the default look rather than a failed artifact.
 */
export async function loadStyle(
  db: { execute(sql: string): Promise<{ rows: readonly Record<string, unknown>[] }> },
  jobId: string,
  projectId: string,
): Promise<StyleProfile | null> {
  return (await loadResolvedStyle(db, jobId, projectId)).profile
}

/**
 * The resolved style as the renderer reads it AND as the database holds it. `raw` is the whole resolved profile
 * (terminology, chart and image settings included, which `readProfile` drops because the renderer does not draw
 * them): it is what a report records as its style snapshot so that "use this report's style" can copy it back
 * without losing a field. `source` is removed, because a snapshot is about the look, not about where a profile came
 * from. Fails open to nothing.
 */
export async function loadResolvedStyle(
  db: { execute(sql: string): Promise<{ rows: readonly Record<string, unknown>[] }> },
  jobId: string,
  projectId: string,
): Promise<{ profile: StyleProfile | null; raw: Record<string, unknown> | null }> {
  try {
    const { rows } = await db.execute(
      `select app.hq_style_get(app.job_office(${lit(jobId)}::uuid),
                               (select p.slug from public.projects p where p.project_id = ${lit(projectId)}::uuid)) as s`,
    )
    const raw = rows[0]?.s
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
    if (!isObject(parsed)) return { profile: null, raw: null }
    const { source: _source, ...whole } = isObject(parsed.profile) ? parsed.profile : {}
    return {
      profile: readProfile(parsed.profile),
      raw: Object.keys(whole).length === 0 ? null : whole,
    }
  } catch {
    return { profile: null, raw: null }
  }
}

/**
 * What a made report records as its style: the resolved profile with the design choices laid over its formatting,
 * because that is what the report actually looked like. Pure.
 */
export function styleSnapshot(
  raw: Record<string, unknown> | null,
  choice: { readonly titlePage: string; readonly density: string },
): Record<string, unknown> {
  const formatting = isObject(raw?.formatting) ? raw.formatting : {}
  return {
    ...(raw ?? {}),
    formatting: { ...formatting, density: choice.density, title_page: choice.titlePage },
  }
}
