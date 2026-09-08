import { request } from '@playwright/test'
import crypto from 'node:crypto'
import path from 'node:path'
import { reviewRoot, reviewSecret } from '../scripts/review-fixtures.mjs'

// Read-only preflight: mutation tests must never run against the user's normal hub.
export default async function verifyReviewServer() {
  const payload = Buffer.from(JSON.stringify({ u: 'review-admin', r: 'admin', exp: Date.now() + 60000 })).toString('base64url')
  const signature = crypto.createHmac('sha256', reviewSecret).update(`user:${payload}`).digest('hex')
  const context = await request.newContext({ baseURL: 'http://localhost:5001', extraHTTPHeaders: { cookie: `moa_user=${payload}.${signature}` } })
  try {
    const response = await context.get('/api/projects')
    const data = await response.json().catch(() => ({}))
    const fixture = data.projects?.find(project => project.slug === 'moa-design')
    if (!response.ok() || fixture?.path !== path.join(reviewRoot, 'projects/moa-design')) {
      throw new Error('UI 검수는 격리 서버에서만 실행할 수 있습니다. 기존 5001 서버를 정상 종료한 뒤 npm run dev:review를 실행하세요.')
    }
  } finally { await context.dispose() }
}
