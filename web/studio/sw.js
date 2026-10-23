/*
  The studio's static files, kept on this device (October 2026).

  WHY. A first visit downloads the page's ~100 files (scripts, stylesheets, fonts). Every later visit used to download them again,
  and on a slow connection that was most of the wait before anything could be clicked. This keeps a copy of each static file, so a
  returning visit loads them from the device.

  WHAT IS NOT CACHED. The page itself (HTML), /config.js (which names the newest build), and everything from the gateway. Those always
  come from the network, so a new release is always seen and data is never stale.

  THE VERSION. The page registers this file with its build version in the URL (sw.js?v=0.25.0). Each release is therefore a new worker
  with a new cache, and the old cache is deleted when the new worker takes over. A file is only kept under the version it came with.
*/

const VERSION = new URL(self.location.href).searchParams.get('v') || 'unversioned'
const CACHE = `hq-static-${VERSION}`

// Static files only. Anything else (the page, config.js, the gateway, other origins) goes to the network untouched.
const STATIC = /\.(?:js|css|woff2?|png|jpe?g|webp|svg|ico)$/i

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('hq-static-') && name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/config.js' || url.pathname.startsWith('/api/')) return
  if (!STATIC.test(url.pathname)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(request)
      if (hit) return hit
      const fresh = await fetch(request)
      // Only a complete, successful answer is kept; a failed or partial one is never stored.
      if (fresh.ok && fresh.type === 'basic') await cache.put(request, fresh.clone())
      return fresh
    })(),
  )
})
