// POST /api/login — { email?, password } → issues a cookie. Rate-limited to 5/min per IP.
// With email: team account login (users.json); without: legacy owner password (=admin).
import { verifyPassword, ownerSetCookie, userSetCookie, PASSWORD_HASH, SECRET } from '../../../lib/auth.mjs'
import { verifyUser } from '../../../lib/users.mjs'
import { j } from '../../../lib/api.mjs'

const attempts = new Map() // ip → [timestamps]

export async function POST(req) {
  if (!SECRET)
    return j({ error: 'Auth is not configured — run `node scripts/set-password.mjs` on the server.' }, 503)
  const ip = req.headers.get('x-forwarded-for') || 'local'
  const now = Date.now()
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 60000)
  if (recent.length >= 5) return j({ error: 'Too many attempts — try again in a minute.' }, 429)
  recent.push(now)
  attempts.set(ip, recent)

  const { email, password } = await req.json().catch(() => ({}))
  if (!password) return j({ error: 'Please enter a password.' }, 400)

  if (email) {
    const user = verifyUser(email, password)
    if (user)
      return new Response(JSON.stringify({ ok: true, role: user.role, name: user.name }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': userSetCookie(user) },
      })
    // Even without an account, the owner password still works — fall through so browser email autofill doesn't lock people out
  }

  if (PASSWORD_HASH && verifyPassword(password))
    return new Response(JSON.stringify({ ok: true, role: 'admin' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': ownerSetCookie() },
    })
  if (!email && !PASSWORD_HASH)
    return j({ error: 'The owner password is not set — log in with email or run `node scripts/set-password.mjs`.' }, 503)
  return j({ error: email ? 'Incorrect email or password.' : 'Incorrect password.' }, 401)
}
