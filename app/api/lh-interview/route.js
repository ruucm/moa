// GET/POST /api/lh-interview — LIGHTHOUSE 「대표 인터뷰 화면」(lighthouse/interview-screen)의 답을 서버에 둔다.
// 2026-11-11 신승진 요청 「저장 버튼 눌러서 서버에 저장」. 실데이터(대표 인터뷰 답)라 git 밖인
// workspace-lighthouse/private/interviews/ 에 대표마다 <id>.json(최신) + history/<id>-<시각>.json(저장할 때마다) 로 쓴다.
// 읽기 · 쓰기 모두 lighthouse 프로젝트에 접근할 수 있는 로그인 계정만(공유 링크 /s/ 는 미들웨어가 막는다).
import fs from 'node:fs'
import path from 'node:path'
import { getAuth, j } from '../../../lib/api.mjs'
import { canAccessProject } from '../../../lib/users.mjs'
import { docPath } from '../../../lib/content.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const SLUG = 'lighthouse'
const IDS = ['psj', 'jhr', 'syg', 'aij', 'psh', 'hsi', 'yso', 'lyj', 'kjh', 'cmj']
const MAX = 300000

const dir = () => {
  const doc = docPath(SLUG, 'interview-screen')
  if (!doc) throw Object.assign(new Error('인터뷰 페이지를 찾을 수 없어요.'), { status: 404 })
  return path.resolve(path.dirname(doc), '../../private/interviews')
}
const allowed = (req) => {
  const auth = getAuth(req)
  if (!auth) return [null, j({ error: '로그인이 필요해요.' }, 401)]
  if (auth.role !== 'admin' && !canAccessProject(auth.user, SLUG)) return [null, j({ error: '프로젝트 접근 권한이 없어요.' }, 403)]
  return [auth, null]
}
const fail = (e) => j({ error: e.status ? e.message : '읽거나 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, e.status || 500)

export async function GET(req) {
  const [, denied] = allowed(req)
  if (denied) return denied
  try {
    const d = dir(), people = {}
    for (const id of IDS) {
      const f = path.join(d, id + '.json')
      if (fs.existsSync(f)) { try { people[id] = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {} }
    }
    return Response.json({ people }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}

export async function POST(req) {
  const [auth, denied] = allowed(req)
  if (denied) return denied
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
  if (origin) {
    try { if (new URL(origin).host !== host) return j({ error: '다른 사이트에서 저장할 수 없어요.' }, 403) } catch { return j({ error: '잘못된 요청이에요.' }, 400) }
  }
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return j({ error: 'JSON 요청이 필요해요.' }, 415)
  try {
    const raw = await req.text()
    if (Buffer.byteLength(raw) > MAX) return j({ error: '내용이 너무 길어요.' }, 413)
    let body
    try { body = JSON.parse(raw) } catch { return j({ error: '내용 형식이 올바르지 않아요.' }, 400) }
    const { id, state } = body || {}
    if (!IDS.includes(id)) return j({ error: '없는 대표님이에요.' }, 400)
    if (!state || typeof state !== 'object' || !Array.isArray(state.cases)) return j({ error: '답 형식이 올바르지 않아요.' }, 400)
    const rec = { state: { cases: state.cases, sel: null, picks: Array.isArray(state.picks) ? state.picks : [] }, savedAt: new Date().toISOString(), savedBy: auth.user?.name || auth.user?.email || '관리자' }
    const d = dir(), h = path.join(d, 'history')
    fs.mkdirSync(h, { recursive: true, mode: 0o700 })
    const out = JSON.stringify(rec, null, 2)
    const tmp = path.join(d, `.${id}.${process.pid}.tmp`)
    fs.writeFileSync(tmp, out, { mode: 0o600 }); fs.renameSync(tmp, path.join(d, id + '.json'))
    fs.writeFileSync(path.join(h, `${id}-${rec.savedAt.replace(/[:.]/g, '-')}.json`), out, { mode: 0o600 })
    return Response.json({ ok: true, savedAt: rec.savedAt, savedBy: rec.savedBy }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fail(e) }
}
