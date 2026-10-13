/* Chef — Service Worker: offline, cache de receitas e notificações de timer */
const VERSION = 'chef-v4';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const IMAGES = `${VERSION}-images`;
const PRECACHE = ['/', '/offline', '/favoritos', '/lista', '/planejador', '/conversor', '/css/app.css', '/js/app.js', '/js/recipe.js', '/js/tools.js', '/icons/icon.svg', '/icons/icon-192.png', '/icons/placeholder.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// Páginas: rede primeiro, cache como fallback (receitas visitadas ficam disponíveis offline)
/** Nunca guarda respostas privadas (páginas de quem está logado, rascunhos, dados do painel). */
function cacheable(res) {
  const cc = res.headers.get('cache-control') || '';
  return res.ok && !/no-store|private/.test(cc);
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (cacheable(res)) { cache.put(req, res.clone()); trim(PAGES, 150); }
    return res;
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: false })) || (await caches.match(req, { ignoreSearch: true }));
    return hit || caches.match('/offline');
  }
}

// Estáticos: cache primeiro, atualiza em segundo plano
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: cacheName === STATIC });
  const net = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/go/') || url.pathname === '/surpresa') return;
    if (url.pathname.startsWith('/api/')) {
      // Só a API pública de leitura vai para o cache offline (nunca chaves, estatísticas, exportação…)
      if (!/^\/api\/v1\/(recipes|search\/suggest|categories|tags)(\/|$|\?)/.test(url.pathname + url.search)) return;
      e.respondWith(fetch(req).then((res) => { if (cacheable(res)) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req)));
      return;
    }
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
    if (/^\/(css|js|icons)\//.test(url.pathname)) return e.respondWith(staleWhileRevalidate(req, STATIC));
    if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/qr/') || url.pathname.startsWith('/capa/')) {
      e.respondWith(staleWhileRevalidate(req, IMAGES).then((r) => { trim(IMAGES, 300); return r; }));
    }
    return;
  }
  if (req.destination === 'image') e.respondWith(staleWhileRevalidate(req, IMAGES));
});

// Mensagens da página: guardar uma receita favorita para leitura offline / limpar ao sair
self.addEventListener('message', (e) => {
  if (e.data?.type === 'cache-url' && /^\/receita\/[\w-]+$/.test(e.data.url)) {
    fetch(e.data.url, { credentials: 'omit' }).then((res) => { if (cacheable(res)) return caches.open(PAGES).then((c) => c.put(e.data.url, res)); }).catch(() => {});
  }
  if (e.data?.type === 'logout') caches.delete(PAGES);
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => 'focus' in w);
    return c ? c.focus() : self.clients.openWindow('/');
  }));
});
