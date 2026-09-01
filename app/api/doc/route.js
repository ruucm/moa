// GET /api/doc?slug=…&doc=… — returns the doc bundle (CJS code).
// Owner: any doc / guest: only the shared doc. Every guest request checks shares.json
// so revocation applies immediately; if valid, the share cookie is renewed (sliding).
import { docPath } from '../../../lib/content.mjs'
import { bundleDoc } from '../../../lib/bundle.mjs'
import { readShareScope, shareSetCookie, SHARE_TTL } from '../../../lib/auth.mjs'
import { findShare } from '../../../lib/shares.mjs'
import { j, getAuth } from '../../../lib/api.mjs'
import { canAccessProject } from '../../../lib/users.mjs'

export async function GET(req) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') || ''
  const doc = url.searchParams.get('doc') || ''

  const auth = getAuth(req)
  // Members can only access docs of their invited projects
  if (auth && auth.role !== 'admin' && !canAccessProject(auth.user, slug))
    return j({ error: 'You do not have access to this project.' }, 403)

  let refreshCookie = null
  if (!auth) { // guests are limited to their share scope
    // Answer by failure cause (the allowed scope is unchanged — just this one doc)
    const scope = readShareScope(req)
    if (!scope) return j({ error: 'Login required.' }, 401)
    const share = findShare(scope.t)
    if (!share) return j({ error: 'This share link has been revoked or expired.' }, 403)
    if (share.slug !== slug || share.doc !== doc)
      return j({ error: 'Access denied.' }, 403)
    refreshCookie = shareSetCookie({
      t: share.token, s: share.slug, d: share.doc,
      m: share.media || [], a: share.api || [], exp: Date.now() + SHARE_TTL,
    })
  }

  const abs = docPath(slug, doc)
  if (!abs) return j({ error: 'Document not found: ' + slug + '/' + doc }, 404)
  const out = await bundleDoc(abs)
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
  if (refreshCookie) headers['Set-Cookie'] = refreshCookie
  return new Response(JSON.stringify(out), { status: out.error ? 422 : 200, headers })
}
