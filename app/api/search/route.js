// GET /api/search?q=…&from=<slug>&limit=… — the pages the reader may open that match q, best first, each with
// an excerpt of the page around the match (see lib/search.mjs). Without q: the most recently updated pages.
// Admins search every project the hub shows (plus the one they are in, `from`, even if hidden); members search
// their invited projects. A share guest never reaches this handler (middleware), and gets 401 here if one did.
import { buildIndex } from '../../../lib/content.mjs'
import { searchDocs, MAX_QUERY } from '../../../lib/search.mjs'
import { j, getAuth } from '../../../lib/api.mjs'

export async function GET(req) {
  const auth = getAuth(req)
  if (!auth) return j({ error: 'Login required.' }, 401)
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').slice(0, MAX_QUERY)
  const from = url.searchParams.get('from') || null
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40))
  const index = buildIndex()
  const hidden = new Set(index.hidden || [])
  const granted = auth.role === 'admin' ? null : new Set(auth.user.projects || [])
  const projects = index.projects.filter((p) => (granted ? granted.has(p.slug) : !hidden.has(p.slug) || p.slug === from))
  return Response.json({ query: q, ...searchDocs(projects, q, { from, limit }) }, { headers: { 'Cache-Control': 'no-store' } })
}
