// POST /api/users/reset — { id } → a single-use password reset link for that account (24 hours). A new link
// replaces the account's earlier unused one; the current password keeps working until the link is used.
// With { id, remove: true }, revokes the pending link.
import { createReset, removeResets } from '../../../../lib/users.mjs'
import { j, guardAdmin } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardAdmin(req)
  if (denied) return denied
  const { id, remove } = await req.json().catch(() => ({}))
  if (!id) return j({ error: 'An id is required.' }, 400)
  if (remove) return j(removeResets(String(id)))
  const r = createReset(String(id))
  return j(r, r.error ? 400 : 200)
}
