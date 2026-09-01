// POST /api/add — { path, title?, slug? } register a folder as a project (symlink + registry entry)
import fs from 'node:fs'
import path from 'node:path'
import { ALLOW, inAllow, ROOT, PROJECTS } from '../../../lib/paths.mjs'
import { readRegistry, writeRegistry } from '../../../lib/content.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const target = path.resolve(body.path || '')
  if (!inAllow(target)) return j({ error: `Only paths under ${ALLOW} can be registered.` }, 403)
  if (target === ALLOW || ROOT.startsWith(target) || target.startsWith(PROJECTS))
    return j({ error: 'This folder cannot be registered.' }, 400)
  let st
  try { st = fs.statSync(target) } catch { return j({ error: 'Path not found: ' + target }, 404) }
  if (!st.isDirectory()) return j({ error: 'Not a directory.' }, 400)

  const slug = (body.slug || path.basename(target)).replace(/[^\w.\-가-힣]/g, '-')
  const link = path.join(PROJECTS, slug)
  if (fs.existsSync(link)) return j({ error: `"${slug}" already exists.` }, 409)

  fs.symlinkSync(target, link)
  const reg = readRegistry()
  reg.projects.push({ slug, path: target, title: body.title || slug, status: 'active' })
  writeRegistry(reg)
  return j({ ok: true, slug })
}
