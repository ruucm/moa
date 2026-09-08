import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { reviewRoot, reviewPassword } from '../scripts/review-fixtures.mjs'

// Reuse real fixture login cookies across test files and repeated runs.
// Login UI behavior has its own tests; other flows should not exhaust throttling.
const cacheFile = path.join(reviewRoot, '../auth-sessions.json')
export async function login(page, email = 'review@moa.example') {
  let sessions = {}
  try { sessions = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) } catch {}
  const cached = sessions[email]
  if (cached?.length && cached.every(cookie => cookie.expires > Date.now() / 1000 + 60)) {
    await page.context().addCookies(cached)
    return
  }
  const response = await page.request.post('/api/login', { data: { email, password: reviewPassword } })
  expect(response.ok(), `fixture login: ${response.status()}`).toBeTruthy()
  sessions[email] = (await page.context().cookies()).filter(cookie => cookie.name === 'moa_user')
  fs.writeFileSync(cacheFile, JSON.stringify(sessions), { mode: 0o600 })
}
