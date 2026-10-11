/**
 * What a generation actually cost, according to the provider's own record (GET /api/v1/generation?id=...).
 *
 * The cost a response reports about itself is one witness and the key's account total is another that other traffic can move;
 * this is the one keyed to a specific generation id.
 */
import { sleep } from './lib.ts'

export interface GenerationRecord {
  readonly id: string
  readonly model: string
  readonly totalCost: number
  readonly upstream: number | null
}

/** The provider reports the SERVED model under a dated slug (nvidia/x-20230311:free); the request named nvidia/x:free. */
export const undated = (id: string): string => id.replace(/-\d{8}(?=:|$)/, '')

export const lookupGenerations = async (
  key: string,
  ids: readonly string[],
): Promise<GenerationRecord[]> => {
  const rows: GenerationRecord[] = []
  for (const id of ids) {
    let record: GenerationRecord | null = null
    // The record can lag the response by a few seconds.
    for (let attempt = 0; attempt < 4 && record === null; attempt += 1) {
      const r = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
        {
          headers: { authorization: `Bearer ${key}` },
        },
      )
      if (r.ok) {
        const d = (
          (await r.json()) as {
            data?: { model?: string; total_cost?: number; upstream_inference_cost?: number | null }
          }
        ).data
        record = {
          id,
          model: d?.model ?? '?',
          totalCost: Number(d?.total_cost ?? Number.NaN),
          upstream: d?.upstream_inference_cost ?? null,
        }
      } else {
        await sleep(2000)
      }
    }
    // A record that cannot be found is NaN cost, which never equals zero: absence is not evidence of free.
    rows.push(record ?? { id, model: '?', totalCost: Number.NaN, upstream: null })
    await sleep(250)
  }
  return rows
}
