// POST /api/share/remove — { token } revoke a share.
// The doc API is blocked immediately; only already-issued media cookies linger for up to 6 hours.
import { removeShare } from '../../../../lib/shares.mjs'
import { j, guardOwner } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { token } = await req.json().catch(() => ({}))
  return removeShare(String(token || ''))
    ? j({ ok: true })
    : j({ error: 'No such token.' }, 404)
}
