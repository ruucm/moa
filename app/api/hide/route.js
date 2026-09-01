// POST /api/hide — { slug, hidden } hide/show a built-in project (no files deleted)
import { readRegistry, writeRegistry } from '../../../lib/content.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, hidden } = await req.json().catch(() => ({}))
  if (!slug) return j({ error: 'A slug is required.' }, 400)
  const reg = readRegistry()
  const set = new Set(reg.hidden || [])
  hidden ? set.add(slug) : set.delete(slug)
  reg.hidden = [...set]
  writeRegistry(reg)
  return j({ ok: true })
}
