// Global auth gate — every request (pages, APIs, public media, proxies) passes through here.
// An owner cookie (moa_owner) passes everything; a share cookie (moa_share) passes only paths within its scope.
// The edge runtime can't use fs, so we only verify signed cookies —
// token issuance (/s/*) and revocation checks are done by Node route handlers reading shares.json directly.
import { NextResponse } from 'next/server'

const enc = new TextEncoder()
let keyPromise = null
const getKey = () => {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw', enc.encode(process.env.MOA_SECRET || ''),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  }
  return keyPromise
}
const hmacHex = async (msg) => {
  const sig = await crypto.subtle.sign('HMAC', await getKey(), enc.encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const cookieVal = (req, name) => {
  const c = req.cookies.get(name)
  return c ? c.value : ''
}

const isOwner = async (req) => {
  const [exp, sig] = cookieVal(req, 'moa_owner').split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  return sig === (await hmacHex('owner:' + exp))
}

// Team account cookie — { u, r, exp }. The edge only checks signature/expiry/role;
// the users.json cross-check (existence, disabled, password reset) happens in the Node routes' getAuth on every request.
const userClaims = async (req) => {
  const [b, sig] = cookieVal(req, 'moa_user').split('.')
  if (!b || !sig) return null
  if (sig !== (await hmacHex('user:' + b))) return null
  try {
    const bin = atob(b.replace(/-/g, '+').replace(/_/g, '/'))
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))))
    return c.exp > Date.now() ? c : null
  } catch { return null }
}

// Paths that must never open for members — chat/trigger spawn processes on this machine.
// Defense in depth alongside guardAdmin in the route handlers.
const ADMIN_PATHS = [
  '/api/chat', '/api/trigger', '/api/claude', '/api/browse', '/api/add', '/api/remove',
  '/api/order', '/api/archive', '/api/hide', '/api/projects/update', '/api/doc/update', '/api/share', '/api/session', '/api/sessions', '/api/users',
]
const isAdminPath = (p) => ADMIN_PATHS.some((a) => p === a || p.startsWith(a + '/'))

const shareScope = async (req) => {
  const [b, sig] = cookieVal(req, 'moa_share').split('.')
  if (!b || !sig) return null
  if (sig !== (await hmacHex('share:' + b))) return null
  try {
    const bin = atob(b.replace(/-/g, '+').replace(/_/g, '/'))
    const scope = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))))
    return scope.exp > Date.now() ? scope : null
  } catch { return null }
}

// Paths accessible without login
const isPublicPath = (p) =>
  p === '/login' || p === '/api/login' || p.startsWith('/s/') ||
  p.startsWith('/join/') || p === '/api/signup' || // invite-link signup — the handler validates the token
  p.startsWith('/reset/') || p === '/api/reset-password' || // admin-issued password reset link — same, single-use token

  p === '/favicon.ico' || p === '/icon.png' || p === '/apple-icon.png' || // home screen icons — Safari fetches them without cookies
  p === '/manifest.webmanifest' // the web app manifest is also requested without cookies

// A dot segment — written out (/a/../b), percent-encoded (%2E%2E) or behind an encoded slash (a%2F..%2Fb).
// Next resolves it before it serves a public/ file, so the file served is not the one the checked path names:
// /<shared folder>%2F..%2F<other folder>/x.jpg passed a share scope, /s/x%2F..%2F..%2F<folder>/x.jpg passed as a
// public path, and /_next/%2E%2E/<folder>/x.jpg skipped the gate as a build asset — each handed out any file in
// public/. Browsers resolve dot segments before they send a request, so only a hand-made URL has one.
const hasDotSegment = (p) =>
  /(?:^|[/\\])\.\.?(?:[/\\]|$)/.test(p.replace(/%2e/gi, '.').replace(/%2f/gi, '/').replace(/%5c/gi, '\\'))

// Is the path allowed by the share scope? — only the page, the doc API, media the doc references, and review proxies.
// A media entry ending in / is a folder of public/ (a prefix); any other is one file at its root.
const shareAllows = (scope, p) => {
  const enc1 = encodeURI
  if (p === `/p/${scope.s}` || p === `/p/${scope.s}/${scope.d}`) return true
  if (p === enc1(`/p/${scope.s}`) || p === enc1(`/p/${scope.s}/${scope.d}`)) return true
  if (p === '/api/doc' || p === '/api/projects') return true // the handler re-restricts by scope
  let dec = p
  try { dec = decodeURIComponent(p) } catch {}
  dec = dec.normalize('NFC') // a Korean file name may be spelled decomposed (NFD) on one side
  for (const m of scope.m || []) {
    const n = String(m).normalize('NFC')
    if (n.endsWith('/') ? dec.startsWith(n) : dec === n) return true
  }
  for (const a of scope.a || []) if (dec === a || dec.startsWith(a + '/')) return true
  return false
}

export async function middleware(req) {
  if (process.env.MOA_NO_AUTH === '1') return NextResponse.next()
  const p = req.nextUrl.pathname
  if (hasDotSegment(p)) return new NextResponse('Bad request', { status: 400 })
  if (p.startsWith('/_next/')) return NextResponse.next() // build assets — app code, not content
  if (isPublicPath(p)) return NextResponse.next()

  if (!process.env.MOA_SECRET) {
    // Auth not configured = everything locked (the login page explains how to set it up)
    if (p.startsWith('/api/')) return NextResponse.json({ error: 'Auth not configured — run scripts/set-password.mjs.' }, { status: 503 })
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (await isOwner(req)) return NextResponse.next()

  const claims = await userClaims(req)
  if (claims) {
    if (claims.r === 'admin' || !isAdminPath(p)) return NextResponse.next()
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  }

  const scope = await shareScope(req)
  if (scope && shareAllows(scope, p)) return NextResponse.next()

  const wantsHtml = (req.headers.get('accept') || '').includes('text/html')
  if (wantsHtml && !p.startsWith('/api/')) {
    const url = new URL('/login', req.url)
    url.searchParams.set('next', p)
    return NextResponse.redirect(url)
  }
  return NextResponse.json({ error: 'Login required.' }, { status: 401 })
}

export const config = {
  // Every request — /_next/ build assets too, since this pattern is matched against the path before its dot segments
  // are resolved: leaving /_next/ out let /_next/%2E%2E/<folder>/x.jpg reach public/ unchecked. Build assets pass
  // right through above.
  matcher: ['/:path*'],
}
