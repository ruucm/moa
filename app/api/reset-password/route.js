// POST /api/reset-password — { token, password } → set a new password from an admin's reset link + immediate login cookie.
// Public like /api/signup — nothing changes without a valid single-use reset token. Sessions issued before the
// change stop working (getAuth compares the cookie's iat with the account's passwordChangedAt).
// GET /api/reset-password?token=… — used by the reset page to pre-validate the link and show whose password it sets.
import { findReset, resetPassword } from '../../../lib/users.mjs'
import { userSetCookie, SECRET } from '../../../lib/auth.mjs'
import { j } from '../../../lib/api.mjs'

const attempts = new Map() // ip → [timestamps]
const limited = (req) => {
  const ip = req.headers.get('x-forwarded-for') || 'local'
  const now = Date.now()
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 60000)
  if (recent.length >= 10) return true
  recent.push(now)
  attempts.set(ip, recent)
  return false
}

export async function GET(req) {
  if (limited(req)) return j({ error: 'Too many attempts — try again in a minute.' }, 429)
  const token = new URL(req.url).searchParams.get('token') || ''
  const r = findReset(token)
  if (r.error) return j({ error: r.error }, 403)
  return j({ ok: true, name: r.user.name, email: r.user.email })
}

export async function POST(req) {
  if (!SECRET) return j({ error: 'Auth is not configured on this server.' }, 503)
  if (limited(req)) return j({ error: 'Too many attempts — try again in a minute.' }, 429)
  const { token, password } = await req.json().catch(() => ({}))
  const found = findReset(String(token || ''))
  if (found.error) return j({ error: found.error }, 403)
  const r = resetPassword(String(token), password)
  if (r.error) return j({ error: r.error }, 400)
  return new Response(JSON.stringify({ ok: true, role: r.user.role, name: r.user.name }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': userSetCookie(r.user) },
  })
}
