// Share management (owner only)
// GET  /api/share            → { shares: [...] }
// POST /api/share { slug, doc } → { share } (if one exists, keeps the token and refreshes the scope)
import { readShares, createShare } from '../../../lib/shares.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function GET(req) {
  return guardOwner(req) || j(readShares())
}

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, doc } = await req.json().catch(() => ({}))
  if (!slug || !doc) return j({ error: 'slug and doc are required.' }, 400)
  const out = createShare(String(slug), String(doc))
  return out.error ? j(out, 404) : j(out)
}
