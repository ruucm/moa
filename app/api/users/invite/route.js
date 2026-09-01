// POST /api/users/invite — { role?, projects? } → create a single-use invite (7 days). A member signs up
// with access to only the projects listed. With { remove: token }, revokes the invite.
import { createInvite, removeInvite } from '../../../../lib/users.mjs'
import { j, guardAdmin } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardAdmin(req)
  if (denied) return denied
  const { role, projects, remove } = await req.json().catch(() => ({}))
  if (remove) return j(removeInvite(String(remove)))
  const invite = createInvite(role, projects)
  return j({ token: invite.token, role: invite.role, projects: invite.projects, exp: invite.exp })
}
