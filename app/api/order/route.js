// POST /api/order — { slugs: [...] } save hub card order (order in steps of 10)
import { readRegistry, writeRegistry } from '../../../lib/content.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slugs } = await req.json().catch(() => ({}))
  if (!Array.isArray(slugs)) return j({ error: 'A slugs array is required.' }, 400)
  const reg = readRegistry()
  const extra = { ...(reg.order || {}) }
  slugs.forEach((slug, i) => {
    const n = (i + 1) * 10
    const p = reg.projects.find((r) => r.slug === slug)
    if (p) { p.order = n; delete extra[slug] } else extra[slug] = n
  })
  reg.order = extra
  writeRegistry(reg)
  return j({ ok: true, count: slugs.length })
}
