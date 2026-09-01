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
// the users.json cross-check (existence, disabled) happens in the Node routes' getAuth on every request.
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
  '/api/order', '/api/hide', '/api/share', '/api/session', '/api/sessions', '/api/users',
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

  p === '/favicon.ico' || p === '/icon.png' || p === '/apple-icon.png' || // home screen icons — Safari fetches them without cookies
  p === '/manifest.webmanifest' // the web app manifest is also requested without cookies

// Is the path allowed by the share scope? — only the page, the doc API, media the doc references, and review proxies
const shareAllows = (scope, p) => {
  const enc1 = encodeURI
  if (p === `/p/${scope.s}` || p === `/p/${scope.s}/${scope.d}`) return true
  if (p === enc1(`/p/${scope.s}`) || p === enc1(`/p/${scope.s}/${scope.d}`)) return true
  if (p === '/api/doc' || p === '/api/projects') return true // the handler re-restricts by scope
  let dec = p
  try { dec = decodeURIComponent(p) } catch {}
  for (const m of scope.m || []) if (dec.startsWith(m)) return true
  for (const a of scope.a || []) if (dec === a || dec.startsWith(a + '/')) return true
  return false
}

export async function middleware(req) {
  if (process.env.MOA_NO_AUTH === '1') return NextResponse.next()
  const p = req.nextUrl.pathname
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
  // Exclude only _next static assets (app code, not content) — public media, APIs, and pages are all checked
  matcher: ['/((?!_next/).*)'],
}
