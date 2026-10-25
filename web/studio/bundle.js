/**
 * The first load's sections, answered by one request (26 October 2026).
 *
 * `index.html` asks the gateway once for `first_load` and keeps the answer in `window.hqBundle`, together with the token it was
 * asked with and the sections already handed out. A read of one section takes its part here, ONCE, and only when the token is the
 * same one. Every other case goes to the network exactly as it did before: no bundle, another token, a section already taken, a
 * bundle that failed, or a section the bundle does not hold. So a bundle can make a load faster; it cannot change what a section
 * answers, and it cannot sign anybody out.
 */
export const takeBundled = (store, section, token) => {
  if (store === undefined || store === null || store.token !== token || store.taken.has(section)) return Promise.resolve(null)
  store.taken.add(section)
  return store.bundle.then(
    (answer) => {
      const part = answer?.data?.[section]
      if (part === undefined || part === null) return null
      return new Response(JSON.stringify(part.body), {
        status: part.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    },
    () => null,
  )
}
