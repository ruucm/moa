// GET /api/sessions?slug=… — list of claude sessions run from this project root (owner only)
import path from 'node:path'
import { readRegistry } from '../../../lib/content.mjs'
import { findClaudeRoot, listSessions } from '../../../lib/claude.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function GET(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const url = new URL(req.url)
  const proj = readRegistry().projects.find((r) => r.slug === url.searchParams.get('slug'))
  if (!proj) return j({ error: 'Not a registered project.' }, 404)
  const root = findClaudeRoot(proj.path) || path.resolve(proj.path)
  return j({ root, ...listSessions(root) })
}
