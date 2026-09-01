// GET /api/me — role/name of the logged-in principal. Used by the UI to decide whether to show admin elements.
import { getAuth } from '../../../lib/api.mjs'
import { j } from '../../../lib/api.mjs'

export async function GET(req) {
  const auth = getAuth(req)
  if (!auth) return j({ error: 'Login required.' }, 401)
  const { user } = auth
  return j({
    role: auth.role,
    name: user ? user.name : 'Owner',
    email: user ? user.email : null,
  })
}
