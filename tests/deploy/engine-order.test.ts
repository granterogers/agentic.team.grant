import { describe, expect, it } from 'vitest'
import { ENGINE_SEAM_NAMES, workerCanAnswerHermes } from '../../scripts/deploy/lib/engine-order.ts'

const SEAM = `
  const hermesRun = await engineRunFor(deps.db, job)
  if (hermesRun !== null) return resumeHermesTurn(deps, job, hermesRun)
  if ((await commandEngine(deps.db, job, id)) === 'hermes') return openHermesTurn(deps, job, {})
`
const DECLARATIONS = `
  export async function engineRunFor(db, job) { return null }
  export const commandEngine = async (db, job, id) => 'team'
`

describe('the worker must be able to answer a Hermes turn before the voice door lets a person choose one', () => {
  it('is ready when the handler awaits both engine calls', () => {
    const v = workerCanAnswerHermes([DECLARATIONS, SEAM])
    expect(v).toEqual({ ready: true, missing: [], modulesRead: 2 })
  })

  it('is NOT ready for a worker that predates the seam (positive control: the same checker says ready above)', () => {
    const v = workerCanAnswerHermes(['export const handler = async (job) => job'])
    expect(v.ready).toBe(false)
    expect(v.missing).toEqual([...ENGINE_SEAM_NAMES])
  })

  it('is NOT ready when only the declarations shipped: a function nothing calls answers nothing', () => {
    expect(workerCanAnswerHermes([DECLARATIONS]).ready).toBe(false)
  })

  it('is NOT ready when the names appear only in comments or an import line', () => {
    const talky = `// await engineRunFor( and await commandEngine( are called below\n/* await engineRunFor(x) */\nimport { engineRunFor, commandEngine } from './turn.ts'`
    expect(workerCanAnswerHermes([talky]).ready).toBe(false)
  })

  it('names exactly what is missing when only one call is present', () => {
    const v = workerCanAnswerHermes(['await engineRunFor(db, job)'])
    expect(v.ready).toBe(false)
    expect(v.missing).toEqual(['commandEngine'])
  })

  it('is never ready for an empty bundle: nothing read is not nothing missing', () => {
    expect(workerCanAnswerHermes([])).toEqual({
      ready: false,
      missing: [...ENGINE_SEAM_NAMES],
      modulesRead: 0,
    })
  })
})
