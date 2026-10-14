// POST /api/pin — { slug, doc, pinned } pin a document to the top of its project's sidebar, or unpin it (the pin in the reader)
// Pinned documents are listed in a "Pinned" group above the project's other groups for every reader, the latest
// pin first. A pin goes by the document's file name and is kept while that file is missing.
import { buildIndex, readRegistry, writeRegistry } from '../../../lib/content.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, doc, pinned } = await req.json().catch(() => ({}))
  if (typeof slug !== 'string' || typeof doc !== 'string' || typeof pinned !== 'boolean') return j({ error: 'A slug, a doc and pinned (true or false) are required.' }, 400)
  const project = buildIndex().projects.find((p) => p.slug === slug)
  if (!project) return j({ error: 'Project not found: ' + slug }, 404)
  if (pinned && !project.docs.some((d) => d.slug === doc)) return j({ error: 'Document not found: ' + doc }, 404)
  const reg = readRegistry()
  const saved = { ...(reg.pins || {}) }
  const docs = (Array.isArray(saved[slug]) ? saved[slug] : []).filter((entry) => entry !== doc)
  if (pinned) docs.unshift(doc)
  if (docs.length) saved[slug] = docs
  else delete saved[slug]
  if (Object.keys(saved).length) reg.pins = saved
  else delete reg.pins
  writeRegistry(reg)
  return j({ ok: true, pinned })
}
