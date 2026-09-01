// Shared helpers for route handlers — JSON responses + role guards.
// Middleware already blocks these routes, but handlers verify on their own too (defense in depth — in case of middleware config mistakes).
// Signed cookies alone can't reflect an account disable immediately, so we cross-check users.json on every request here.
import { isOwner, readUserCookie, NO_AUTH } from './auth.mjs'
import { findUserById } from './users.mjs'

export const j = (body, status = 200) => Response.json(body, { status })

// Authenticated principal of the request — { role: 'admin'|'member', user? } or null.
// Legacy owner cookie (password login) is treated as admin. Team accounts must exist in users.json and not be disabled.
export const getAuth = (req) => {
  if (NO_AUTH) return { role: 'admin' }
  if (isOwner(req)) return { role: 'admin' }
  const c = readUserCookie(req)
  if (!c) return null
  const user = findUserById(c.u)
  if (!user || user.disabled) return null
  return { role: user.role, user }
}

export const guardUser = (req) => (getAuth(req) ? null : j({ error: 'Login required.' }, 401))
export const guardAdmin = (req) => {
  const auth = getAuth(req)
  if (!auth) return j({ error: 'Login required.' }, 401)
  if (auth.role !== 'admin') return j({ error: 'Admins only.' }, 403)
  return null
}
// Compatibility for existing routes — owner-only = admin-only
export const guardOwner = guardAdmin
