import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { login } from './review-session.mjs'
import path from 'node:path'
import { reviewRoot } from '../scripts/review-fixtures.mjs'

// The suite shares fictional state with the other UI tests; playwright.config.mjs
// runs one worker. Preserve exact file contents even when an assertion fails.
test.describe.configure({ mode: 'serial' })

async function preserveFixtureState(run) {
  const snapshots = ['registry.json', 'users.json', 'shares.json'].map(name => {
    const file = path.join(reviewRoot, name)
    return { file, contents: fs.readFileSync(file) }
  })
  try {
    await run()
  } finally {
    for (const { file, contents } of snapshots) fs.writeFileSync(file, contents)
  }
}

async function openSettings(page, tab = 'Projects') {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Workspace menu' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: tab, exact: true }).click()
  return dialog
}

async function fixtureIndex(page) {
  const response = await page.request.get('/api/projects')
  expect(response.ok()).toBeTruthy()
  const index = await response.json()
  const reviewProject = index.projects.find(project => project.slug === 'moa-design')
  expect(reviewProject?.path, 'Run this suite against npm run dev:review only.')
    .toBe(path.join(reviewRoot, 'projects', 'moa-design'))
  return index
}

function waitForMutation(page, endpoint, matches) {
  return page.waitForResponse(response => {
    const request = response.request()
    return new URL(response.url()).pathname === endpoint
      && request.method() === 'POST'
      && matches(request.postDataJSON())
  })
}

test('설정의 멤버 접근 편집이 저장되고 기존 세션에 바로 반영됨', async ({ page, browser }) => {
  await preserveFixtureState(async () => {
    await login(page)
    await fixtureIndex(page)
    const usersBefore = await (await page.request.get('/api/users')).json()
    const memberBefore = usersBefore.users.find(user => user.id === 'review-member')
    expect(memberBefore.projects).toContain('brand-notes')
    const expectedWithoutBrand = memberBefore.projects.filter(slug => slug !== 'brand-notes')
    const memberContext = await browser.newContext({ baseURL: 'http://localhost:5001' })

    try {
      const memberPage = await memberContext.newPage()
      await login(memberPage, 'member@moa.example')
      expect((await memberPage.request.get('/api/doc?slug=brand-notes&doc=overview')).status()).toBe(200)

      let dialog = await openSettings(page, 'Team members')
      await expect(dialog.getByText('member@moa.example', { exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Edit access', exact: true }).click()
      // The first fieldset creates invitations; the second edits this member.
      let access = dialog.getByRole('group', { name: /Accessible projects/ }).last()
      let brand = access.getByRole('checkbox', { name: '브랜드의 다음 장', exact: true })
      await expect(brand).toBeChecked()
      const removed = waitForMutation(page, '/api/users/update', body => body.id === 'review-member')
      await brand.uncheck()
      expect((await removed).ok()).toBeTruthy()
      await expect(brand).not.toBeChecked()
      await expect(brand).toBeEnabled()
      const saved = await (await page.request.get('/api/users')).json()
      expect(saved.users.find(user => user.id === 'review-member').projects).toEqual(expectedWithoutBrand)
      expect((await memberPage.request.get('/api/doc?slug=brand-notes&doc=overview')).status()).toBe(403)

      // Reopening from a fresh page verifies persisted access, not local checkbox state.
      dialog = await openSettings(page, 'Team members')
      await dialog.getByRole('button', { name: 'Edit access', exact: true }).click()
      access = dialog.getByRole('group', { name: /Accessible projects/ }).last()
      brand = access.getByRole('checkbox', { name: '브랜드의 다음 장', exact: true })
      await expect(brand).not.toBeChecked()
      const restored = waitForMutation(page, '/api/users/update', body => body.id === 'review-member')
      await brand.check()
      expect((await restored).ok()).toBeTruthy()
      await expect(brand).toBeChecked()
      await expect(brand).toBeEnabled()
      const afterRestore = await (await page.request.get('/api/users')).json()
      expect(afterRestore.users.find(user => user.id === 'review-member').projects.slice().sort())
        .toEqual(memberBefore.projects.slice().sort())
      expect((await memberPage.request.get('/api/doc?slug=brand-notes&doc=overview')).status()).toBe(200)

      // A rejected save must restore the checkbox and keep actual access intact.
      const rejectAccessChange = route => route.fulfill({
        status: 500,
        json: { error: '검수용 접근 권한 저장 실패' },
      })
      await page.route('**/api/users/update', rejectAccessChange)
      try {
        const rejected = waitForMutation(page, '/api/users/update', body => body.id === 'review-member')
        // Use click: an immediate mock failure may roll back before uncheck's
        // built-in final-state assertion, and rollback is what this step tests.
        await brand.click()
        expect((await rejected).status()).toBe(500)
        await expect(dialog.getByText('검수용 접근 권한 저장 실패', { exact: true })).toBeVisible()
        await expect(brand).toBeChecked()
        await expect(brand).toBeEnabled()
        const afterFailure = await (await page.request.get('/api/users')).json()
        expect(afterFailure.users.find(user => user.id === 'review-member').projects.slice().sort())
          .toEqual(memberBefore.projects.slice().sort())
        expect((await memberPage.request.get('/api/doc?slug=brand-notes&doc=overview')).status()).toBe(200)
      } finally {
        await page.unroute('**/api/users/update', rejectAccessChange)
      }
    } finally {
      await memberContext.close()
    }
  })
})

test('설정에서 내장 프로젝트를 숨겼다가 다시 표시해도 문서는 유지됨', async ({ page }) => {
  await preserveFixtureState(async () => {
    await login(page)
    const before = await fixtureIndex(page)
    expect(before.hidden || []).not.toContain('guide')
    expect(before.projects.find(project => project.slug === 'guide').registered).toBeFalsy()
    let dialog = await openSettings(page)
    const rowForGuide = () => dialog.locator('div')
      .filter({ has: page.getByText('MOA Design System', { exact: true }) })
      .filter({ has: page.getByRole('button', { name: /^(Hide|Show again)$/ }) })
      .last()

    const hidden = waitForMutation(page, '/api/hide', body => body.slug === 'guide' && body.hidden === true)
    await rowForGuide().getByRole('button', { name: 'Hide', exact: true }).click()
    expect((await hidden).ok()).toBeTruthy()
    await expect(rowForGuide().getByRole('button', { name: 'Show again', exact: true })).toBeVisible()
    expect((await fixtureIndex(page)).hidden).toContain('guide')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'MOA Design System', exact: true })).toHaveCount(0)
    expect((await page.request.get('/api/doc?slug=guide&doc=design-system')).status()).toBe(200)

    dialog = await openSettings(page)
    const shown = waitForMutation(page, '/api/hide', body => body.slug === 'guide' && body.hidden === false)
    await rowForGuide().getByRole('button', { name: 'Show again', exact: true }).click()
    expect((await shown).ok()).toBeTruthy()
    await expect(rowForGuide().getByRole('button', { name: 'Hide', exact: true })).toBeVisible()
    expect((await fixtureIndex(page)).hidden || []).not.toContain('guide')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'MOA Design System', exact: true })).toBeVisible()
  })
})

test('설정에서 공유 링크를 회수하면 목록과 외부 진입에서 바로 제거됨', async ({ page, request }) => {
  await preserveFixtureState(async () => {
    await login(page)
    await fixtureIndex(page)
    const token = 'review-document-link-only'
    const before = await (await page.request.get('/api/share')).json()
    expect(before.shares.some(share => share.token === token)).toBe(true)
    const entry = await request.get(`/s/${token}`, { maxRedirects: 0 })
    expect(entry.status()).toBe(302)
    expect(entry.headers().location).toBe('/p/moa-design/overview')

    const dialog = await openSettings(page, 'Shared links')
    await expect(dialog.getByText('더 명확하게, 더 편안하게', { exact: true })).toBeVisible()
    const revoked = waitForMutation(page, '/api/share/remove', body => body.token === token)
    await dialog.getByRole('button', { name: 'Revoke', exact: true }).click()
    expect((await revoked).ok()).toBeTruthy()
    await expect(dialog.getByText('Share link revoked.', { exact: true })).toBeVisible()
    await expect(dialog.getByText('더 명확하게, 더 편안하게', { exact: true })).toHaveCount(0)
    const after = await (await page.request.get('/api/share')).json()
    expect(after.shares.some(share => share.token === token)).toBe(false)
    const removedEntry = await request.get(`/s/${token}`, { maxRedirects: 0 })
    expect(removedEntry.status()).toBe(302)
    expect(removedEntry.headers().location).toMatch(/^\/login\?msg=/)
    expect(decodeURIComponent(removedEntry.headers().location)).toContain('This share link has expired or been revoked.')
  })
})
