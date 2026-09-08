import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { reviewRoot, reviewPassword } from '../scripts/review-fixtures.mjs'

// Only the isolated review fixture is touched. Every mutation is restored even on failure.
const usersFile = path.join(reviewRoot, 'users.json')
const withInvitation = async (token, run) => {
  const before = fs.readFileSync(usersFile, 'utf8')
  const data = JSON.parse(before)
  data.invites = [...(data.invites || []).filter(invite => invite.token !== token), {
    token, role: 'member', projects: ['moa-design'],
    createdAt: new Date().toISOString(), exp: Date.now() + 3600000, usedBy: null,
  }]
  try {
    fs.writeFileSync(usersFile, JSON.stringify(data, null, 2))
    await run()
  } finally {
    fs.writeFileSync(usersFile, before)
  }
}

test('초대 가입: 입력 검증, 중복 이메일 복구, 자동 로그인, 사용된 초대', async ({ page }) => {
  const token = 'review-auth-success-invitation'
  await withInvitation(token, async () => {
    await page.goto(`/join/${token}`)
    await expect(page.getByText('Invitation verified', { exact: true })).toBeVisible()
    await expect(page.getByText('Team member', { exact: true })).toBeVisible()
    const submit = page.getByRole('button', { name: 'Create account', exact: true })
    await expect(submit).toBeDisabled()
    await page.getByLabel('Name', { exact: true }).fill('가입 검수용 팀원')
    await page.getByLabel('Email', { exact: true }).fill('member@moa.example')
    await page.getByLabel('Password', { exact: true }).fill('12345')
    await expect(submit).toBeDisabled()
    await page.getByLabel('Password', { exact: true }).fill(reviewPassword)
    await expect(submit).toBeEnabled()

    const duplicate = page.waitForResponse(response => response.url().endsWith('/api/signup') && response.request().method() === 'POST')
    await submit.click()
    expect((await duplicate).status()).toBe(400)
    await expect(page.getByRole('main').getByRole('alert')).toContainText('This email is already registered.')
    expect(JSON.parse(fs.readFileSync(usersFile, 'utf8')).invites.find(invite => invite.token === token).usedBy).toBeNull()

    const email = `signup-${Date.now()}@moa.example`
    await page.getByLabel('Email', { exact: true }).fill(email)
    const signup = page.waitForResponse(response => response.url().endsWith('/api/signup') && response.request().method() === 'POST')
    await submit.click()
    expect((await signup).status()).toBe(200)
    await expect(page).toHaveURL(/\/$/)
    expect((await page.context().cookies()).some(cookie => cookie.name === 'moa_user')).toBe(true)
    const me = await page.request.get('/api/me')
    expect(me.ok()).toBe(true)
    expect(await me.json()).toMatchObject({ role: 'member', name: '가입 검수용 팀원', email })
    const projects = await page.request.get('/api/projects')
    expect(projects.ok()).toBe(true)
    expect((await projects.json()).projects.map(project => project.slug)).toEqual(['moa-design'])
    expect((await page.request.get('/api/users')).status()).toBe(403)

    await page.context().clearCookies()
    const used = page.waitForResponse(response => response.url().includes('/api/signup?token=') && response.request().method() === 'GET')
    await page.goto(`/join/${token}`)
    expect((await used).status()).toBe(403)
    await expect(page.getByRole('main').getByRole('alert')).toContainText('This invite link has already been used.')
    await expect(page.getByRole('form', { name: 'Join team' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Go to login' })).toBeVisible()
  })
})

test('초대 확인: HTTP 503 재시도와 유효하지 않은 링크의 안내 구분', async ({ page }) => {
  const token = 'review-auth-retry-invitation'
  await withInvitation(token, async () => {
    let allowRetry = false
    await page.route(`**/api/signup?token=${token}`, route => allowRetry
      ? route.continue()
      : route.fulfill({ status: 503, json: { error: '검수용 일시적 서버 오류' } }))
    await page.goto(`/join/${token}`)
    await expect(page.getByRole('main').getByRole('alert')).toContainText('검수용 일시적 서버 오류')
    await expect(page.getByText('Please try again shortly.', { exact: true })).toBeVisible()
    await expect(page.getByText('If the link has expired or was already used, ask an admin for a new invitation.', { exact: true })).toHaveCount(0)
    allowRetry = true
    const retry = page.waitForResponse(response => response.url().includes(`/api/signup?token=${token}`) && response.status() === 200)
    await page.getByRole('button', { name: 'Check again', exact: true }).click()
    await retry
    await expect(page.getByRole('form', { name: 'Join team' })).toBeVisible()
    await expect(page.getByLabel('Name', { exact: true })).toBeVisible()

    await page.goto('/join/review-auth-invitation-does-not-exist')
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Invite link not found or revoked.')
    await expect(page.getByRole('button', { name: 'Check again', exact: true })).toHaveCount(0)
    await expect(page.getByText('If the link has expired or was already used, ask an admin for a new invitation.', { exact: true })).toBeVisible()
  })
})

test('로그인 실패: 요청 중 상태, 버튼 너비 유지, 오류 후 입력 복구 (모의 응답)', async ({ page }) => {
  let releaseResponse
  let requestBody
  const pendingResponse = new Promise(resolve => { releaseResponse = resolve })
  await page.route('**/api/login', async route => {
    requestBody = route.request().postDataJSON()
    await pendingResponse
    await route.fulfill({ status: 401, json: { error: '이메일 또는 비밀번호가 달라요.' } })
  })
  try {
    await page.goto('/login')
    await page.evaluate(() => document.fonts.ready)
    await page.getByLabel('Email', { exact: true }).fill('review@moa.example')
    await page.getByLabel('Password', { exact: true }).fill(`${reviewPassword}-incorrect`)
    const submit = page.getByRole('button', { name: 'Log in', exact: true })
    const initialBox = await submit.boundingBox()
    expect(initialBox).not.toBeNull()
    await submit.click()
    await expect(submit).toHaveAttribute('aria-busy', 'true')
    await expect(submit).toBeDisabled()
    await expect(page.getByLabel('Email', { exact: true })).toBeDisabled()
    await expect(page.getByRole('radio', { name: 'Owner password', exact: true })).toBeDisabled()
    const loadingBox = await submit.boundingBox()
    expect(loadingBox).not.toBeNull()
    expect(Math.abs(loadingBox.width - initialBox.width)).toBeLessThanOrEqual(1)
    await expect.poll(() => requestBody).toEqual({ email: 'review@moa.example', password: `${reviewPassword}-incorrect` })
    releaseResponse()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('이메일 또는 비밀번호가 달라요.')
    await expect(submit).toBeEnabled()
    await expect(submit).not.toHaveAttribute('aria-busy', 'true')
    await expect(page.getByLabel('Email', { exact: true })).toBeEnabled()
    await expect(page).toHaveURL(/\/login$/)
  } finally {
    releaseResponse()
  }
})
