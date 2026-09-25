// POST /api/projects/update — { slug, title?, description? } edit what the hub shows for a project.
// A registered project keeps the change in registry.json (the connected folder is never modified);
// a local project writes it to its _meta.json. Admin only.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../../../../lib/paths.mjs'
import { buildIndex, readRegistry, writeRegistry } from '../../../../lib/content.mjs'
import { j, guardOwner } from '../../../../lib/api.mjs'

const LIMITS = { title: 120, description: 300 }

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const slug = typeof body.slug === 'string' ? body.slug : ''
  if (!slug) return j({ error: 'A slug is required.' }, 400)

  // Whitespace collapses to single spaces: both fields are shown on one line.
  const changes = {}
  for (const key of Object.keys(LIMITS)) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'string') return j({ error: `The ${key} must be text.` }, 400)
    const text = body[key].replace(/\s+/g, ' ').trim()
    if (text.length > LIMITS[key]) return j({ error: `The ${key} can have at most ${LIMITS[key]} characters.` }, 400)
    changes[key] = text
  }
  if (changes.title === '') return j({ error: 'A title is required.' }, 400)
  if (Object.keys(changes).length === 0) return j({ error: 'Nothing to change.' }, 400)

  const project = buildIndex().projects.find((p) => p.slug === slug)
  if (!project) return j({ error: 'Project not found: ' + slug }, 404)
  if (project.demo) return j({ error: 'Demo projects cannot be edited.' }, 400)

  if (project.registered) {
    const reg = readRegistry()
    const entry = (reg.projects || []).find((r) => r.slug === slug)
    if (!entry) return j({ error: 'Project not found: ' + slug }, 404)
    Object.assign(entry, changes)
    writeRegistry(reg)
  } else {
    const file = path.join(ROOT, project.root, slug, '_meta.json')
    let meta = null
    try { meta = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {}
    Object.assign(meta, changes)
    fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n')
  }
  return j({ ok: true, project: { slug, title: changes.title ?? project.title, description: changes.description ?? project.description ?? '' } })
}
