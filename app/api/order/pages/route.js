// POST /api/order/pages — { slug, group, docs: [...] } save the order of the pages inside one group of a project's
// sidebar, as an admin dragged them into place (the reader): the pages' file names. Only the pages the group holds
// now are kept, once each; an empty list goes back to the default (the pages by their order meta). Saved in the
// registry under pageOrder[slug][group] for every reader; the files are not touched.
import { buildIndex, readRegistry, writeRegistry } from '../../../../lib/content.mjs'
import { j, guardOwner } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, group, docs } = (await req.json().catch(() => null)) || {}
  if (typeof slug !== 'string' || typeof group !== 'string' || !group || !Array.isArray(docs))
    return j({ error: 'A slug, a group and a docs array are required.' }, 400)
  const project = buildIndex().projects.find((p) => p.slug === slug)
  if (!project) return j({ error: 'Project not found: ' + slug }, 404)
  const inGroup = new Set(project.docs.filter((d) => d.group === group).map((d) => d.slug))
  if (docs.length && !inGroup.size) return j({ error: 'Group not found: ' + group }, 404)
  const items = [...new Set(docs.filter((doc) => typeof doc === 'string' && inGroup.has(doc)))]
  const reg = readRegistry()
  const all = { ...(reg.pageOrder || {}) }
  // A group may have any name: the project's groups are kept as entries, not as assignments to an object.
  const saved = new Map(all[slug] && typeof all[slug] === 'object' && !Array.isArray(all[slug]) ? Object.entries(all[slug]) : [])
  if (items.length) saved.set(group, items)
  else saved.delete(group)
  if (saved.size) all[slug] = Object.fromEntries(saved)
  else delete all[slug]
  if (Object.keys(all).length) reg.pageOrder = all
  else delete reg.pageOrder
  writeRegistry(reg)
  return j({ ok: true, count: items.length })
}
