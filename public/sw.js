const VERSION = 'bayarlah-pwa-v3'
const STATIC_CACHE = VERSION + '-static'
const OFFLINE_URL = '/offline'

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE)
    await cache.addAll([OFFLINE_URL, '/icons/icon-192.svg', '/icons/icon-512.svg', '/icons/icon.svg', '/icons/apple-touch-icon.svg'])
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('bayarlah-pwa-') && key !== STATIC_CACHE).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)

  // Never cache APIs, shared receipt pages, participant state, or cross-origin resources.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  const isStaticAsset = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')
  if (isStaticAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
      return response
    })())
    return
  }

  // Navigation is network-first. Receipt HTML is never persisted.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request)
      } catch {
        const cache = await caches.open(STATIC_CACHE)
        return (await cache.match(OFFLINE_URL)) || Response.error()
      }
    })())
  }
})
