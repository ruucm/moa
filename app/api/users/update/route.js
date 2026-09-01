// POST /api/users/update — { id, disabled } disable/enable · { id, remove: true } delete (admin only)
// Blocks disabling/deleting the last admin account — prevents accidentally locking yourself out.
import { readUsers, setUserDisabled, removeUser, setUserProjects } from '../../../../lib/users.mjs'
import { j, guardAdmin } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardAdmin(req)
  if (denied) return denied
  const { id, disabled, remove, projects } = await req.json().catch(() => ({}))
  if (!id) return j({ error: 'An id is required.' }, 400)
  if (projects !== undefined) {
    const r = setUserProjects(id, projects)
    return j(r, r.error ? 400 : 200)
  }

  const target = readUsers().users.find((u) => u.id === id)
  if (target && target.role === 'admin' && (remove || disabled)) {
    const admins = readUsers().users.filter((u) => u.role === 'admin' && !u.disabled)
    // Not a full lockout since legacy owner password login still works, but block it as a safeguard
    if (admins.length <= 1) return j({ error: 'The last admin account cannot be disabled or deleted.' }, 400)
  }

  const r = remove ? removeUser(id) : setUserDisabled(id, !!disabled)
  return j(r, r.error ? 400 : 200)
}
