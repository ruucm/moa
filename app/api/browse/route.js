// GET /api/browse?path=… — list subfolders (for the registration UI, owner only)
import fs from 'node:fs'
import path from 'node:path'
import { ALLOW, inAllow } from '../../../lib/paths.mjs'
import { readRegistry } from '../../../lib/content.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

const countMdx = (dir) => {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.mdx')).length } catch { return 0 }
}

export async function GET(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const url = new URL(req.url)
  const p = path.resolve(url.searchParams.get('path') || ALLOW)
  if (!inAllow(p)) return j({ error: `Only paths under ${ALLOW} can be browsed.` }, 403)
  let st
  try { st = fs.statSync(p) } catch { return j({ error: 'Path not found: ' + p }, 404) }
  if (!st.isDirectory()) return j({ error: 'Not a directory: ' + p }, 400)
  const registered = new Set(readRegistry().projects.map((r) => r.path))
  const dirs = fs.readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map((d) => {
      const full = path.join(p, d.name)
      return { name: d.name, path: full, mdxCount: countMdx(full), registered: registered.has(full) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const parent = path.dirname(p)
  return j({ path: p, parent: inAllow(parent) ? parent : null, dirs })
}
