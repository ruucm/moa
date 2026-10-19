import { test, expect, request } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { login } from './review-session.mjs'
import { reviewRoot, reviewSecret } from '../scripts/review-fixtures.mjs'
import { hashPassword } from '../lib/auth.mjs'

// Only the isolated review fixture is touched: each test adds a throwaway account and restores users.json
// byte-for-byte. The login and reset endpoints rate-limit per x-forwarded-for, so every context here gets its
// own bucket — these tests log in and open links more often than the rest of the suite can spare.
const baseURL = 'http://localhost:5001'
const usersFile = path.join(reviewRoot, 'users.json')
// Not reviewPassword: the review server's owner password is that same string, and /api/login falls back to it
// for any email — the old password would then still "work" after the reset.
const oldPassword = 'reset-review-old-password'
const newPassword = 'reset-review-new-password'
const readUsersFile = () => JSON.parse(fs.readFileSync(usersFile, 'utf8'))
const ownBucket = (name) => ({ 'x-forwarded-for': `password-reset-${name}-${Date.now()}` })
const noAxeViolations = async (page, label) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), label).toEqual([])
}

const withAccount = async (run) => {
  const before = fs.readFileSync(usersFile)
  const stamp = Date.now()
  const account = {
    id: `review-reset-${stamp}`, email: `reset-${stamp}@moa.example`, name: '재설정 검수용 팀원', role: 'member',
    projects: ['moa-design'], hash: hashPassword(oldPassword), createdAt: new Date().toISOString(), disabled: false,
  }
  const data = JSON.parse(before)
  data.users.push(account)
  try {
    fs.writeFileSync(usersFile, JSON.stringify(data, null, 2))
    await run(account)
  } finally {
    fs.writeFileSync(usersFile, before)
  }
}

async function openMembers(page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('tab', { name: 'Team members', exact: true }).click()
  await expect(dialog.getByText('member@moa.example', { exact: true })).toBeVisible()
  return dialog
}

const memberRow = (page, dialog, email) => dialog.locator('div')
  .filter({ has: page.getByText(email, { exact: true }) })
  .filter({ has: page.getByRole('button', { name: /^(Disable|Reactivate)$/ }) }).last()

// A moa_user cookie as minted before cookies carried iat
const legacyCookie = (id) => {
  const payload = Buffer.from(JSON.stringify({ u: id, r: 'member', exp: Date.now() + 600000 })).toString('base64url')
  return `moa_user=${payload}.${crypto.createHmac('sha256', reviewSecret).update(`user:${payload}`).digest('hex')}`
}

test('비밀번호 재설정: 관리자가 링크를 복사하고, 팀원이 새 비밀번호로 바꾸면 이전 세션이 끊김', async ({ page, browser }) => {
  await login(page)
  await withAccount(async (account) => {
    const before = await browser.newContext({ baseURL, extraHTTPHeaders: ownBucket('before') })
    const holder = await browser.newContext({ baseURL, extraHTTPHeaders: ownBucket('holder') })
    const legacy = await request.newContext({ baseURL, extraHTTPHeaders: { cookie: legacyCookie(account.id) } })
    try {
      // The teammate's sessions from before the reset: a fresh login, and a cookie without iat
      const beforePage = await before.newPage()
      expect((await beforePage.request.post('/api/login', { data: { email: account.email, password: oldPassword } })).status()).toBe(200)
      expect((await beforePage.request.get('/api/me')).status()).toBe(200)
      expect((await legacy.get('/api/me')).status()).toBe(200)

      const dialog = await openMembers(page)
      await page.evaluate(() => {
        window.resetClipboard = []
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          writeText: async value => { window.resetClipboard.push(value) },
        } })
      })
      const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users/reset' && response.request().method() === 'POST')
      await memberRow(page, dialog, account.email).getByRole('button', { name: 'Reset password', exact: true }).click()
      const response = await created
      expect(response.ok()).toBe(true)
      expect(response.request().postDataJSON()).toEqual({ id: account.id })
      const { token, exp } = await response.json()
      expect(token).toMatch(/^rst_[\w-]{32}$/)
      expect(exp - Date.now()).toBeGreaterThan(24 * 3600 * 1000 - 60000)
      expect(exp - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000)
      await expect(dialog.getByText(`Password reset link for ${account.name} copied. It can be used once within 24 hours.`, { exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => window.resetClipboard)).toEqual([`${baseURL}/reset/${token}`])
      const pending = dialog.locator('section').filter({ has: page.getByRole('heading', { name: /^Pending password resets/ }) })
      await expect(pending.getByText(account.name, { exact: true })).toBeVisible()
      await dialog.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)) })
      await noAxeViolations(page, 'Team members with a pending reset')
      // users.json holds only the token's hash, and the old password still works until the link is used
      const stored = readUsersFile()
      expect(JSON.stringify(stored)).not.toContain(token)
      expect(stored.resets.find(reset => reset.userId === account.id).tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'))
      expect(stored.users.find(user => user.id === account.id).hash).toBe(account.hash)
      expect((await beforePage.request.get('/api/me')).status()).toBe(200)

      const holderPage = await holder.newPage()
      await holderPage.goto(`/reset/${token}`)
      await expect(holderPage.getByText('Reset link verified', { exact: true })).toBeVisible()
      await expect(holderPage.getByText(account.email, { exact: true })).toBeVisible()
      const submit = holderPage.getByRole('button', { name: 'Save new password', exact: true })
      await expect(submit).toBeDisabled()
      await holderPage.getByLabel('New password', { exact: true }).fill('12345')
      await holderPage.getByLabel('Confirm new password', { exact: true }).fill('12345')
      await expect(submit).toBeDisabled()
      await holderPage.getByLabel('New password', { exact: true }).fill(newPassword)
      await holderPage.getByLabel('Confirm new password', { exact: true }).fill(newPassword.slice(0, 5))
      await expect(holderPage.getByText('Passwords do not match.', { exact: true })).toHaveCount(0)
      await holderPage.getByLabel('Confirm new password', { exact: true }).fill(`${newPassword}-typo`)
      await expect(holderPage.getByText('Passwords do not match.', { exact: true })).toBeVisible()
      await expect(submit).toBeDisabled()
      await holderPage.setViewportSize({ width: 320, height: 720 })
      expect(await holderPage.evaluate(() => globalThis.document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
      await holderPage.evaluate(() => globalThis.document.fonts.ready)
      await noAxeViolations(holderPage, '/reset at 320px')
      await holderPage.getByLabel('Confirm new password', { exact: true }).fill(newPassword)
      await expect(submit).toBeEnabled()
      const saved = holderPage.waitForResponse(response => new URL(response.url()).pathname === '/api/reset-password' && response.request().method() === 'POST')
      await submit.click()
      expect((await saved).status()).toBe(200)
      await expect(holderPage).toHaveURL(/\/$/)
      await expect(holderPage.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
      expect(await (await holderPage.request.get('/api/me')).json()).toMatchObject({ role: 'member', email: account.email })

      // Same account — id, role, projects — with a new hash
      const changed = readUsersFile().users.find(user => user.id === account.id)
      expect(changed).toMatchObject({ email: account.email, role: 'member', projects: account.projects, disabled: false })
      expect(changed.hash).not.toBe(account.hash)
      expect(Date.now() - Date.parse(changed.passwordChangedAt)).toBeLessThan(60000)

      // Every session issued before the reset is refused; its tab lands on the login page
      expect((await legacy.get('/api/me')).status()).toBe(401)
      expect((await beforePage.request.get('/api/me')).status()).toBe(401)
      expect((await beforePage.request.get('/api/doc?slug=moa-design&doc=overview')).status()).toBe(401)
      await beforePage.goto('/p/moa-design/overview')
      await expect(beforePage).toHaveURL(/\/login\?next=%2Fp%2Fmoa-design%2Foverview$/)
      expect((await beforePage.request.post('/api/login', { data: { email: account.email, password: oldPassword } })).status()).toBe(401)
      expect((await beforePage.request.post('/api/login', { data: { email: account.email, password: newPassword } })).status()).toBe(200)
      expect((await beforePage.request.get('/api/me')).status()).toBe(200)

      // The link works once
      const reopened = holderPage.waitForResponse(response => response.url().includes('/api/reset-password?token=') && response.request().method() === 'GET')
      await holderPage.goto(`/reset/${token}`)
      expect((await reopened).status()).toBe(403)
      await expect(holderPage.getByRole('main').getByRole('alert')).toContainText('This reset link has already been used.')
      await expect(holderPage.getByRole('form', { name: 'Reset password' })).toHaveCount(0)
      expect((await holderPage.request.post('/api/reset-password', { data: { token, password: 'another-password' } })).status()).toBe(403)
      expect((await (await page.request.get('/api/users')).json()).resets.some(reset => reset.userId === account.id)).toBe(false)
    } finally {
      await before.close()
      await holder.close()
      await legacy.dispose()
    }
  })
})

test('비밀번호 재설정: 만료·교체·회수·비활성 계정의 링크는 거절되고, 관리자만 만든다', async ({ page, browser }) => {
  await login(page)
  await withAccount(async (account) => {
    const guest = await request.newContext({ baseURL, extraHTTPHeaders: ownBucket('links') })
    const member = await browser.newContext({ baseURL })
    try {
      const create = async () => {
        const response = await page.request.post('/api/users/reset', { data: { id: account.id } })
        expect(response.ok()).toBe(true)
        return (await response.json()).token
      }
      const refused = async (response, error) => {
        expect(response.status()).toBe(403)
        expect((await response.json()).error).toBe(error)
      }
      const check = token => guest.get(`/api/reset-password?token=${encodeURIComponent(token)}`)

      // Admins only: no session 401, a member session 403 — for someone else's account or their own
      expect((await guest.post('/api/users/reset', { data: { id: account.id } })).status()).toBe(401)
      const memberPage = await member.newPage()
      await login(memberPage, 'member@moa.example')
      expect((await memberPage.request.post('/api/users/reset', { data: { id: account.id } })).status()).toBe(403)
      expect((await memberPage.request.post('/api/users/reset', { data: { id: 'review-member' } })).status()).toBe(403)
      expect(readUsersFile().resets || []).toEqual([])

      // A new link replaces the earlier one
      const first = await create()
      const second = await create()
      await refused(await check(first), 'Reset link not found or revoked.')
      const valid = await check(second)
      expect(valid.status()).toBe(200)
      expect(await valid.json()).toEqual({ ok: true, name: account.name, email: account.email })

      // Revoke from the pending list
      const dialog = await openMembers(page)
      const pending = dialog.locator('section').filter({ has: page.getByRole('heading', { name: /^Pending password resets/ }) })
      const revoked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users/reset'
        && response.request().method() === 'POST' && response.request().postDataJSON()?.remove === true)
      await pending.getByRole('button', { name: 'Revoke', exact: true }).click()
      expect((await revoked).ok()).toBe(true)
      await expect(dialog.getByText('Reset link revoked.', { exact: true })).toBeVisible()
      await expect(dialog.getByRole('heading', { name: /^Pending password resets/ })).toHaveCount(0)
      await refused(await check(second), 'Reset link not found or revoked.')

      // An expired link refuses both the check and the change
      const third = await create()
      const data = readUsersFile()
      data.resets.find(reset => reset.userId === account.id && !reset.usedAt).exp = Date.now() - 1000
      fs.writeFileSync(usersFile, JSON.stringify(data, null, 2))
      await refused(await check(third), 'This reset link has expired — ask an admin for a new one.')
      await refused(await guest.post('/api/reset-password', { data: { token: third, password: newPassword } }), 'This reset link has expired — ask an admin for a new one.')

      // Disabling the account drops its pending link (reactivating doesn't bring it back) and hides the button
      const fourth = await create()
      expect((await page.request.post('/api/users/update', { data: { id: account.id, disabled: true } })).ok()).toBe(true)
      await refused(await check(fourth), 'Reset link not found or revoked.')
      expect(readUsersFile().resets.some(reset => reset.userId === account.id && !reset.usedAt)).toBe(false)
      const disabled = await page.request.post('/api/users/reset', { data: { id: account.id } })
      expect(disabled.status()).toBe(400)
      expect((await disabled.json()).error).toBe('Reactivate this account before resetting its password.')
      await dialog.getByRole('tab', { name: 'Projects', exact: true }).click()
      await dialog.getByRole('tab', { name: 'Team members', exact: true }).click()
      await expect(memberRow(page, dialog, account.email).getByRole('button', { name: 'Reactivate', exact: true })).toBeVisible()
      await expect(memberRow(page, dialog, account.email).getByRole('button', { name: 'Reset password', exact: true })).toHaveCount(0)

      // Made-up tokens
      await refused(await check('rst_review-link-does-not-exist'), 'Reset link not found or revoked.')
      await refused(await guest.post('/api/reset-password', { data: { password: newPassword } }), 'Reset link not found or revoked.')

      // Nothing above changed the password
      expect(readUsersFile().users.find(user => user.id === account.id).hash).toBe(account.hash)
    } finally {
      await guest.dispose()
      await member.close()
    }
  })
})

test('비밀번호 재설정: 공개 경로는 재설정 페이지와 그 API 뿐', async ({ browser }) => {
  const anonymous = await browser.newContext({ baseURL, extraHTTPHeaders: ownBucket('paths') })
  try {
    const page = await anonymous.newPage()
    await page.goto('/reset/rst_review-link-does-not-exist')
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Reset link not found or revoked.')
    await expect(page.getByText('If the link has expired or was already used, ask an admin for a new one.', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go to login' })).toBeVisible()

    for (const pathname of ['/api/users', '/api/users/reset', '/api/projects', '/api/me', '/api/doc?slug=moa-design&doc=overview', '/api/reset-password/x']) {
      expect((await anonymous.request.get(pathname, { maxRedirects: 0 })).status(), pathname).toBe(401)
    }
    expect((await anonymous.request.post('/api/users/reset', { data: { id: 'review-member' } })).status()).toBe(401)
    for (const pathname of ['/', '/reset', '/p/moa-design', '/p/moa-design/overview']) {
      const response = await anonymous.request.get(pathname, { maxRedirects: 0, headers: { accept: 'text/html' } })
      expect(response.status(), pathname).toBe(307)
      expect(response.headers().location, pathname).toContain('/login')
    }
  } finally {
    await anonymous.close()
  }
})
