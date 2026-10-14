// GET /api/projects — project/doc index.
// Owner: everything (+registry, hidden). Share guest: a stripped-down version with just that one doc (guest:true).
// Guest failures are answered by cause — previously everything was a 401 "Login required",
// which hid the real cause (even a deleted/renamed doc showed the login screen).
import { buildIndex } from '../../../lib/content.mjs'
import { readShareScope } from '../../../lib/auth.mjs'
import { findShare } from '../../../lib/shares.mjs'
import { j, getAuth } from '../../../lib/api.mjs'

export async function GET(req) {
  const auth = getAuth(req)
  if (auth && auth.role === 'admin') return j({ owner: true, ...buildIndex() })
  // Team member: sees only invited projects (owner:false + member:true)
  if (auth) {
    const granted = new Set(auth.user.projects || [])
    const idx = buildIndex()
    return j({
      member: true,
      user: { name: auth.user.name, role: auth.role },
      projects: idx.projects.filter((p) => granted.has(p.slug)).map((p) => ({ ...p, path: undefined })),
      hidden: [], registryProjects: [],
    })
  }

  // 1) The share cookie is missing/expired/forged — a genuine auth problem
  const scope = readShareScope(req)
  if (!scope) return j({ error: 'Login required.' }, 401)

  // 2) The token was revoked in shares.json
  const share = findShare(scope.t)
  if (!share) return j({ error: 'This share link has been revoked or expired.' }, 403)

  // 3) The token is valid but the doc is gone (.mdx deleted/renamed, project unregistered)
  const { projects } = buildIndex()
  const p = projects.find((x) => x.slug === scope.s)
  const doc = p && p.docs.find((d) => d.slug === scope.d)
  if (!p || !doc)
    return j({ error: `Shared document not found — it may have been deleted or renamed: ${scope.s}/${scope.d}` }, 404)

  return j({
    guest: true,
    projects: [{ ...p, docs: [doc], registered: false, path: undefined }],
    hidden: [], registryProjects: [],
  })
}
