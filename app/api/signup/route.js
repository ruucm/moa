// POST /api/signup — { token, email, name, password } → sign up via invite link + immediate login cookie.
// The only public signup path — no account can be created without a valid single-use invite token.
// GET /api/signup?token=… — used by the signup page to pre-validate the token.
import { findInvite, createUser, consumeInvite } from '../../../lib/users.mjs'
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
  const r = findInvite(token)
  if (r.error) return j({ error: r.error }, 403)
  return j({ ok: true, role: r.invite.role, projects: r.invite.projects || [] })
}

export async function POST(req) {
  if (!SECRET) return j({ error: 'Auth is not configured on this server.' }, 503)
  if (limited(req)) return j({ error: 'Too many attempts — try again in a minute.' }, 429)
  const { token, email, name, password } = await req.json().catch(() => ({}))
  const r = findInvite(token || '')
  if (r.error) return j({ error: r.error }, 403)
  const made = createUser({ email, name, password, role: r.invite.role, projects: r.invite.projects })
  if (made.error) return j({ error: made.error }, 400)
  consumeInvite(token, made.user.id)
  return new Response(JSON.stringify({ ok: true, role: made.user.role, name: made.user.name }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': userSetCookie(made.user) },
  })
}
