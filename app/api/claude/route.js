// GET /api/claude — .claude skill/agent lists per registered project (owner only)
import { readRegistry } from '../../../lib/content.mjs'
import { listClaude } from '../../../lib/claude.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function GET(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const out = {}
  for (const r of readRegistry().projects) out[r.slug] = listClaude(r.path)
  return j(out)
}
