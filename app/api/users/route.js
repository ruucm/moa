// GET /api/users — list of members and valid invites (admin only, hashes excluded)
import { listForAdmin } from '../../../lib/users.mjs'
import { j, guardAdmin } from '../../../lib/api.mjs'

export async function GET(req) {
  const denied = guardAdmin(req)
  if (denied) return denied
  return j(listForAdmin())
}
