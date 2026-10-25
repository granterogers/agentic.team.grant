import { describe, expect, it } from 'vitest'

import { limiter } from '../../web/studio/limit.js'

const later = () => new Promise<void>((ok) => setTimeout(ok, 5))

describe('the section reads are capped, and nothing is lost by the cap', () => {
  it('never has more tasks running at once than the limit', async () => {
    const run = limiter(4)
    let running = 0
    let most = 0
    await Promise.all(
      Array.from({ length: 11 }, () =>
        run(async () => {
          running += 1
          most = Math.max(most, running)
          await later()
          running -= 1
        }),
      ),
    )
    expect(most).toBe(4)
    expect(running).toBe(0)
  })

  it('starts the waiting tasks in the order they asked', async () => {
    const run = limiter(2)
    const started: number[] = []
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        run(async () => {
          started.push(i)
          await later()
        }),
      ),
    )
    expect(started).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('gives the answer of each task back to its own caller', async () => {
    const run = limiter(3)
    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        run(async () => {
          await later()
          return i * 10
        }),
      ),
    )
    expect(answers).toEqual([0, 10, 20, 30, 40, 50, 60, 70])
  })

  it('a task that fails gives its place back, so the queue keeps moving', async () => {
    const run = limiter(1)
    const first = run(async () => {
      throw new Error('boom')
    })
    const second = run(async () => 'second ran')
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('second ran')
  })
})
