/**
 * sw.js — 허브 공용 서비스워커 (스코프 `/`)
 *
 * 캐시 전략:
 *   허브 셸 (index.html, core/store.js, manifest.json, icon.svg)  precache + SWR
 *   위성앱 (/MCQ/, /CASE_Practice/, /Core_Notes/, /RECORD/)       런타임 stale-while-revalidate
 *   data/*.json (수 MB)                                          런타임 network-first만. precache 금지
 *
 * 범위 충돌 주의:
 *   위성앱이 자기 서비스워커를 `/CASE_Practice/` 스코프로 등록하면 브라우저가
 *   더 좁은 스코프를 우선한다 — 그때 이 워커는 해당 경로 요청을 아예 보지 않는다.
 *   그전까지는 이 워커가 대신 처리하되, 언제나 네트워크 응답을 우선 반영하고
 *   캐시는 실패 시 폴백으로만 쓴다(위성앱 배포를 캐시가 붙잡지 않도록).
 */
'use strict';

const VERSION = 'v2';
const SHELL_CACHE   = `lawhub-shell-${VERSION}`;
const RUNTIME_CACHE = `lawhub-runtime-${VERSION}`;
const DATA_CACHE    = `lawhub-data-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, RUNTIME_CACHE, DATA_CACHE]);

// 허브 자신의 셸만 precache한다. 위성앱·데이터는 절대 넣지 않는다.
const SHELL = ['./', './index.html', './core/store.js', './manifest.json', './icon.svg'];

const SATELLITE_RE = /^\/(MCQ|CASE_Practice|Core_Notes|RECORD)\//;
const isDataJson = (p) => p.includes('/data/') && p.endsWith('.json');

// ── install ──────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 개별 addAll 실패가 설치 전체를 막지 않도록 하나씩 넣는다.
    await Promise.all(SHELL.map(u =>
      cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

// ── activate: 옛 버전 캐시 정리 ────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n.startsWith('lawhub-') && !KEEP.has(n))
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// ── 전략 ─────────────────────────────────────────
function cacheable(res) {
  return res && res.ok && res.status === 200 && res.type === 'basic';
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) return cached;
  const res = await network;
  if (res) return res;
  throw new Error('offline and not cached');
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

// 위성앱: 네트워크 우선 + 캐시 폴백. 오프라인일 때만 캐시가 답한다.
async function satellite(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    if (cacheable(res)) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // 위성앱 문서를 오프라인에서 못 열면 허브 셸로 보내지 않고 그대로 실패시킨다.
    // (허브 index.html을 /MCQ/ 자리에 끼워 넣으면 더 헷갈린다.)
    throw err;
  }
}

// ── fetch ────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;          // 부분요청은 건드리지 않는다

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // 교차 오리진은 브라우저에 맡긴다

  const path = url.pathname;

  // data/*.json — 수 MB. precache 금지, 런타임 network-first만.
  if (isDataJson(path)) {
    e.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // 위성앱 경로 — 이 워커가 아직 담당 중일 때만 여기로 온다.
  const scopePath = new URL(self.registration.scope).pathname;
  const rel = path.startsWith(scopePath) ? '/' + path.slice(scopePath.length) : path;
  if (SATELLITE_RE.test(rel)) {
    e.respondWith(satellite(req));
    return;
  }

  // 허브 문서 요청은 network-first. 캐시 우선으로 두면 허브를 새로 배포해도
  // 방문자가 한 번은 옛 화면을 보게 된다(VERSION을 올려야만 갱신).
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        return await networkFirst(req, SHELL_CACHE);
      } catch (err) {
        const fallback = await caches.match('./index.html', { cacheName: SHELL_CACHE });
        if (fallback) return fallback;
        throw err;
      }
    })());
    return;
  }

  // 그 밖의 셸 자산(css/js/아이콘)은 stale-while-revalidate.
  e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});
