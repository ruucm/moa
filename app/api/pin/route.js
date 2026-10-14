// POST /api/pin — { slug, doc, pinned } pin a document to the top of its project's sidebar for the signed-in
// account, or unpin it (the pin in the reader). Every account keeps its own pins, the latest first (lib/pins.mjs).
import { buildIndex } from '../../../lib/content.mjs'
import { savePin } from '../../../lib/pins.mjs'
import { j, getAuth } from '../../../lib/api.mjs'

export async function POST(req) {
  const auth = getAuth(req)
  if (!auth) return j({ error: 'Login required.' }, 401)
  const { slug, doc, pinned } = await req.json().catch(() => ({}))
  if (typeof slug !== 'string' || typeof doc !== 'string' || typeof pinned !== 'boolean') return j({ error: 'A slug, a doc and pinned (true or false) are required.' }, 400)
  // Members can only pin in their invited projects
  if (auth.role !== 'admin' && !(auth.user.projects || []).includes(slug)) return j({ error: 'You do not have access to this project.' }, 403)
  const project = buildIndex().projects.find((p) => p.slug === slug)
  if (!project) return j({ error: 'Project not found: ' + slug }, 404)
  if (pinned && !project.docs.some((d) => d.slug === doc)) return j({ error: 'Document not found: ' + doc }, 404)
  savePin(auth, slug, doc, pinned)
  return j({ ok: true, pinned })
}
