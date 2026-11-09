// POST /api/order/groups — { slug, groups: [...] } save the top of a project's sidebar list as an admin dragged it
// into place (the reader): group names, and { doc: slug } for a page outside any group. Only the project's current
// groups and its pages outside any group are kept, once each; an empty list goes back to the default (the groups by
// their order meta, then the pages outside any group).
import { buildIndex, readRegistry, writeRegistry } from '../../../../lib/content.mjs'
import { j, guardOwner } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, groups } = await req.json().catch(() => ({}))
  if (typeof slug !== 'string' || !Array.isArray(groups)) return j({ error: 'A slug and a groups array are required.' }, 400)
  const project = buildIndex().projects.find((p) => p.slug === slug)
  if (!project) return j({ error: 'Project not found: ' + slug }, 404)
  const known = new Set(project.docs.map((d) => d.group).filter(Boolean))
  const loose = new Set(project.docs.filter((d) => !d.group).map((d) => d.slug))
  const seen = new Set()
  const items = []
  for (const item of groups) {
    const key = typeof item === 'string' ? known.has(item) && `group:${item}` : typeof item?.doc === 'string' && loose.has(item.doc) && `page:${item.doc}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push(typeof item === 'string' ? item : { doc: item.doc })
  }
  const reg = readRegistry()
  const saved = { ...(reg.groupOrder || {}) }
  if (items.length) saved[slug] = items
  else delete saved[slug]
  if (Object.keys(saved).length) reg.groupOrder = saved
  else delete reg.groupOrder
  writeRegistry(reg)
  return j({ ok: true, count: items.length })
}
