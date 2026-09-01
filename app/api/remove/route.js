// POST /api/remove — { slug } unregister (removes only the symlink, original stays intact)
import fs from 'node:fs'
import path from 'node:path'
import { PROJECTS } from '../../../lib/paths.mjs'
import { readRegistry, writeRegistry } from '../../../lib/content.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug } = await req.json().catch(() => ({}))
  const reg = readRegistry()
  const idx = reg.projects.findIndex((r) => r.slug === slug)
  if (idx < 0) return j({ error: 'Not a registered project: ' + slug }, 404)
  const link = path.join(PROJECTS, slug)
  try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link) } catch {}
  reg.projects.splice(idx, 1)
  writeRegistry(reg)
  return j({ ok: true })
}
