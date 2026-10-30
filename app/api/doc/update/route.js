// POST /api/doc/update — { slug, doc, title?, group? } rename a page, or move it to another group (the reader's sidebar).
// Rewrites the title or group literal at the top of the page's .mdx — where the sidebar reads them — and leaves the
// rest of the file as it was (lib/content.mjs setDocMeta). '' as the group takes the page out of its group.
// Admin only; demo projects cannot be edited.
import fs from 'node:fs'
import { buildIndex, docPath, parseDocMeta, setDocMeta } from '../../../../lib/content.mjs'
import { j, guardOwner } from '../../../../lib/api.mjs'

const LIMIT = 200

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const slug = typeof body.slug === 'string' ? body.slug : ''
  const doc = typeof body.doc === 'string' ? body.doc : ''
  if (!slug || !doc) return j({ error: 'A slug and a doc are required.' }, 400)

  // Whitespace collapses to single spaces: the sidebar shows each on one line.
  const changes = {}
  for (const key of ['title', 'group']) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'string') return j({ error: `The ${key} must be text.` }, 400)
    const text = body[key].replace(/\s+/g, ' ').trim()
    if (text.length > LIMIT) return j({ error: `The ${key} can have at most ${LIMIT} characters.` }, 400)
    if (text.includes('\\')) return j({ error: `The ${key} can't contain a backslash (\\).` }, 400)
    changes[key] = text
  }
  if (changes.title === '') return j({ error: 'A title is required.' }, 400)
  if (Object.keys(changes).length === 0) return j({ error: 'Nothing to change.' }, 400)

  const project = buildIndex().projects.find((p) => p.slug === slug)
  if (!project) return j({ error: 'Project not found: ' + slug }, 404)
  if (project.demo) return j({ error: 'Demo projects cannot be edited.' }, 400)
  const file = project.docs.some((d) => d.slug === doc) && docPath(slug, doc)
  if (!file) return j({ error: 'Document not found: ' + doc }, 404)

  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { return j({ error: 'Document not found: ' + doc }, 404) }
  const next = setDocMeta(src, changes)
  if (next.error) return j({ error: next.error }, 422)
  // Nothing new leaves the file, and its modification time, alone.
  if (next.src !== src) {
    try { fs.writeFileSync(file, next.src) } catch (e) { return j({ error: 'Could not save the page: ' + (e.code || e.message) }, 500) }
  }
  const meta = parseDocMeta(next.src)
  return j({ ok: true, doc: { slug: doc, title: meta.title || doc, group: meta.group || null } })
}
