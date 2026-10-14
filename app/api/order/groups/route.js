// POST /api/order/groups — { slug, groups: [...] } save a project's sidebar group order (drag in the reader)
// Only the names of the project's current groups are kept, once each; an empty list goes back to the order meta.
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
  const names = [...new Set(groups.filter((name) => known.has(name)))]
  const reg = readRegistry()
  const saved = { ...(reg.groupOrder || {}) }
  if (names.length) saved[slug] = names
  else delete saved[slug]
  if (Object.keys(saved).length) reg.groupOrder = saved
  else delete reg.groupOrder
  writeRegistry(reg)
  return j({ ok: true, count: names.length })
}
