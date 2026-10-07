import type { Kind, Proof, Quarantined } from './types.ts'

/**
 * One line per proof: `p('name', floor, 'the invariant it guards')`. The floor is the fewest assertions the proof may
 * report (about 80% of what it reports today) so a proof that silently loses its checks goes red instead of green.
 */
export const p = (
  name: string,
  min: number,
  why: string,
  rest: Partial<Omit<Proof, 'name' | 'min' | 'why'>> = {},
): Proof => ({ name, min, why, ...rest })

/** A proof that runs by a special route (its own setup script, a psql file, an attack suite). */
export const via = (
  kind: Kind,
  name: string,
  min: number,
  why: string,
  rest: Partial<Omit<Proof, 'name' | 'min' | 'why' | 'kind'>> = {},
): Proof => ({ name, min, why, kind, ...rest })

/** A proof that is out of the gate, with what replaced it. */
export const out = (
  name: string,
  why: string,
  replacedBy: string,
  rest: Partial<Omit<Proof, 'name' | 'min' | 'why'>> = {},
): Quarantined => ({ name, min: 0, why, replacedBy, ...rest })
