// POST /api/archive — { slug, doc | group, archived } take a page, or a whole group, out of the project's sidebar
// list into its Archived group, or bring it back (the menu of a row in the reader). Saved in the registry under
// archived[slug] as { groups, docs } for every reader; the files are not touched, and the pages still open.
import { buildIndex, readRegistry, writeRegistry } from '../../../lib/content.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, doc, group, archived } = await req.json().catch(() => ({}))
  const key = typeof doc === 'string' && doc ? 'docs' : typeof group === 'string' && group ? 'groups' : null
  if (typeof slug !== 'string' || !key || (doc != null && group != null) || typeof archived !== 'boolean')
    return j({ error: 'A slug, a doc or a group, and archived (true or false) are required.' }, 400)
  const project = buildIndex().projects.find((p) => p.slug === slug)
  if (!project) return j({ error: 'Project not found: ' + slug }, 404)
  const name = key === 'docs' ? doc : group
  if (archived && !project.docs.some((d) => (key === 'docs' ? d.slug : d.group) === name))
    return j({ error: (key === 'docs' ? 'Document not found: ' : 'Group not found: ') + name }, 404)
  const reg = readRegistry()
  const all = { ...(reg.archived || {}) }
  const strings = (list) => Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []
  const saved = { groups: strings(all[slug]?.groups), docs: strings(all[slug]?.docs) }
  saved[key] = saved[key].filter((item) => item !== name)
  if (archived) saved[key].push(name)
  if (saved.groups.length || saved.docs.length) all[slug] = saved
  else delete all[slug]
  if (Object.keys(all).length) reg.archived = all
  else delete reg.archived
  writeRegistry(reg)
  return j({ ok: true, archived })
}
