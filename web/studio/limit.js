/**
 * At most `max` tasks run at once; the rest wait their turn, in the order they asked.
 *
 * Why this exists (26 October 2026). A first load sent eleven section reads together. The office's database host had too little
 * memory to answer that many heavy queries at once, so some came back 502 and the page left its board empty. Capping the number in
 * flight keeps the same work in the same order and removes the burst that the host could not serve.
 *
 * A task that fails releases its place, so one failure never holds the queue.
 */
export const limiter = (max) => {
  let running = 0
  const waiting = []
  const take = () =>
    new Promise((ok) => {
      if (running < max) {
        running += 1
        ok()
      } else waiting.push(ok)
    })
  // A finished task hands its place straight to the next one waiting, so the count is unchanged in that case.
  const give = () => {
    const next = waiting.shift()
    if (next !== undefined) next()
    else running -= 1
  }
  return async (task) => {
    await take()
    try {
      return await task()
    } finally {
      give()
    }
  }
}
