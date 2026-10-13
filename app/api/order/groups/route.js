// POST /api/order/groups — { slug, groups: [...] } save a project's sidebar group order (drag in the reader)
// Only the names of the project's current groups are kept, once each; an empty list goes back to the order meta.
import { saveGroupNames } from '../../../../lib/content.mjs'
import { j, guardOwner } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, groups } = await req.json().catch(() => ({}))
  if (typeof slug !== 'string' || !Array.isArray(groups)) return j({ error: 'A slug and a groups array are required.' }, 400)
  const names = saveGroupNames('groupOrder', slug, groups)
  if (!names) return j({ error: 'Project not found: ' + slug }, 404)
  return j({ ok: true, count: names.length })
}
