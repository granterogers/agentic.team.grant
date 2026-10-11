/**
 * OpenRouter's public model catalogue, and the test for "actually free".
 *
 * A model is free here only if EVERY price field in the catalogue is exactly zero. The name is not evidence: in the October 2026
 * catalogue `inclusionai/ling-3.1-flash` is zero-priced with no `:free` suffix, and `openrouter/free` is a router that picks a
 * model at random. The catalogue endpoint needs no credential.
 */

export interface CatalogueModel {
  readonly id: string
  readonly context_length?: number | null
  readonly pricing?: Record<string, string | number | null | undefined>
  readonly supported_parameters?: readonly string[]
  readonly [k: string]: unknown
}

/** Every price field present must parse to exactly 0. A missing pricing block is NOT free (unknown is not zero). */
export const isZeroPriced = (m: CatalogueModel): boolean => {
  const p = m.pricing
  if (p === undefined || p === null) return false
  const entries = Object.entries(p)
  if (entries.length === 0) return false
  return entries.every(([, v]) => {
    if (v === null || v === undefined || v === '') return true
    const n = Number(v)
    return Number.isFinite(n) && n === 0
  })
}

export interface Candidate {
  readonly id: string
  readonly context: number
  readonly nameSaysFree: boolean
}

/** Zero-priced, at least `minContext` tokens, tools supported, and not a router. Sorted by context, largest first. */
export const candidates = (all: readonly CatalogueModel[], minContext = 64_000): Candidate[] =>
  all
    .filter(
      (m) =>
        isZeroPriced(m) &&
        (m.context_length ?? 0) >= minContext &&
        (m.supported_parameters ?? []).includes('tools') &&
        !m.id.startsWith('openrouter/'),
    )
    .map((m) => ({
      id: m.id,
      context: m.context_length ?? 0,
      nameSaysFree: m.id.endsWith(':free'),
    }))
    .sort((a, b) => b.context - a.context)

export const fetchCatalogue = async (): Promise<CatalogueModel[]> => {
  const response = await fetch('https://openrouter.ai/api/v1/models')
  if (!response.ok) throw new Error(`catalogue ${String(response.status)}`)
  return ((await response.json()) as { data: CatalogueModel[] }).data
}
