import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { login } from './review-session.mjs'
import { reviewRoot, reviewPassword } from '../scripts/review-fixtures.mjs'

// The existing global setup and the per-test path check both require the
// isolated review server. All file snapshots are restored byte-for-byte.
// No email is sent; invitation copying uses an in-browser clipboard mock.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/claude', route => route.fulfill({ json: {} }))
})

async function fixtureIndex(page) {
  const response = await page.request.get('/api/projects')
  expect(response.ok()).toBeTruthy()
  const index = await response.json()
  expect(index.projects.find(project => project.slug === 'moa-design')?.path,
    'Run against the isolated review server only.').toBe(path.join(reviewRoot, 'projects', 'moa-design'))
  return index
}

async function openHub(page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
}

async function openMembers(page) {
  await openHub(page)
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('tab', { name: 'Team members', exact: true }).click()
  await expect(dialog.getByText('member@moa.example', { exact: true })).toBeVisible()
  return dialog
}

const mutation = (page, pathname, matches) => page.waitForResponse(response =>
  new URL(response.url()).pathname === pathname && response.request().method() === 'POST'
  && matches(response.request().postDataJSON()))

test('dragging a project saves the complete order and persists after reload', async ({ page }) => {
  await login(page)
  const index = await fixtureIndex(page)
  const registryFile = path.join(reviewRoot, 'registry.json')
  const registryBefore = fs.readFileSync(registryFile)
  const hidden = new Set(index.hidden || [])
  const projects = index.projects.filter(project => !project.demo && !hidden.has(project.slug))
  expect(projects.length).toBeGreaterThan(1)
  const expected = projects.map(project => project.slug)
  expected.splice(0, 0, expected.splice(1, 1)[0])
  try {
    await openHub(page)
    const list = page.getByRole('list', { name: 'Project list', exact: true })
    await expect(list.getByRole('listitem')).toHaveCount(projects.length)
    const first = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: projects[0].title, exact: true }) })
    const second = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: projects[1].title, exact: true }) })
    await expect(second).toHaveAttribute('draggable', 'true')
    const saved = mutation(page, '/api/order', body => Array.isArray(body.slugs))
    // Real mouse drag events exercise native DataTransfer and the drag/drop hook.
    await second.dragTo(first, { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: 8, y: 8 } })
    const response = await saved
    expect(response.ok()).toBeTruthy()
    expect(response.request().postDataJSON().slugs).toEqual(expected)
    await expect(list.getByRole('heading', { level: 3 }).first()).toHaveText(projects[1].title)
    await page.reload()
    await expect(list.getByRole('listitem')).toHaveCount(projects.length)
    await expect.poll(() => list.locator('a[href^="/p/"]').evaluateAll(links => links.map(link => decodeURIComponent(new URL(link.href).pathname.split('/')[2])))).toEqual(expected)
    const persisted = await fixtureIndex(page)
    expect(persisted.projects.filter(project => !project.demo && !hidden.has(project.slug)).map(project => project.slug)).toEqual(expected)
  } finally {
    fs.writeFileSync(registryFile, registryBefore)
  }
})

test('logging out calls the real API and clears both owner and team cookies', async ({ page }) => {
  await login(page)
  await fixtureIndex(page)
  expect((await page.context().cookies()).some(cookie => cookie.name === 'moa_user')).toBe(true)
  const ownerLogin = await page.request.post('/api/login', { data: { password: reviewPassword } })
  expect(ownerLogin.ok()).toBeTruthy()
  expect((await page.context().cookies()).filter(cookie => ['moa_user', 'moa_owner'].includes(cookie.name)).map(cookie => cookie.name).sort()).toEqual(['moa_owner', 'moa_user'])
  await openHub(page)
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click()
  const loggedOut = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logout' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  expect((await loggedOut).ok()).toBeTruthy()
  await expect(page).toHaveURL(/\/login$/)
  expect((await page.context().cookies()).filter(cookie => ['moa_user', 'moa_owner'].includes(cookie.name))).toEqual([])
  expect((await page.request.get('/api/me')).status()).toBe(401)
  expect((await page.request.get('/api/projects')).status()).toBe(401)
})

test('Settings creates and revokes an admin invitation through the real fixture API', async ({ page }) => {
  await login(page)
  await fixtureIndex(page)
  const usersFile = path.join(reviewRoot, 'users.json')
  const usersBefore = fs.readFileSync(usersFile)
  try {
    const dialog = await openMembers(page)
    await page.evaluate(() => {
      window.publicFlowClipboard = []
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async value => { window.publicFlowClipboard.push(value) },
      } })
    })
    await dialog.getByRole('button', { name: 'Invite admin', exact: true }).click()
    await expect(dialog.getByText('Invite an admin?', { exact: true })).toBeVisible()
    const created = mutation(page, '/api/users/invite', body => body.role === 'admin' && !body.remove)
    await dialog.getByRole('button', { name: 'Create admin invitation link', exact: true }).click()
    const response = await created
    expect(response.ok()).toBeTruthy()
    expect(response.request().postDataJSON()).toEqual({ role: 'admin', projects: [] })
    const invitation = await response.json()
    expect(invitation).toMatchObject({ role: 'admin', projects: [] })
    await expect(dialog.getByText('Invitation link copied. It can be used once within 7 days.', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.publicFlowClipboard)).toEqual([`http://localhost:5001/join/${invitation.token}`])
    const afterCreate = await (await page.request.get('/api/users')).json()
    expect(afterCreate.invites.find(item => item.token === invitation.token)).toMatchObject({ role: 'admin', projects: [] })

    const pending = dialog.locator('section').filter({ has: page.getByRole('heading', { name: /^Pending invitations/ }) })
    const adminRow = pending.locator('div')
      .filter({ has: page.locator('strong').filter({ hasText: /^Invite admin$/ }) })
      .filter({ has: page.getByRole('button', { name: 'Revoke', exact: true }) }).last()
    const revoked = mutation(page, '/api/users/invite', body => body.remove === invitation.token)
    await adminRow.getByRole('button', { name: 'Revoke', exact: true }).click()
    expect((await revoked).ok()).toBeTruthy()
    await expect(dialog.getByText('Invitation revoked.', { exact: true })).toBeVisible()
    const afterRevoke = await (await page.request.get('/api/users')).json()
    expect(afterRevoke.invites.some(item => item.token === invitation.token)).toBe(false)
    await expect(pending.locator('strong').filter({ hasText: /^Invite admin$/ })).toHaveCount(0)
    expect(afterRevoke.users).toEqual(afterCreate.users)
  } finally {
    fs.writeFileSync(usersFile, usersBefore)
  }
})

test('disabling, reactivating and deleting a fixture member immediately changes existing-cookie access', async ({ page, browser }) => {
  await login(page)
  await fixtureIndex(page)
  const usersFile = path.join(reviewRoot, 'users.json')
  const usersBefore = fs.readFileSync(usersFile)
  const memberContext = await browser.newContext({ baseURL: 'http://localhost:5001' })
  try {
    const memberPage = await memberContext.newPage()
    await login(memberPage, 'member@moa.example')
    const originalCookie = (await memberContext.cookies()).find(cookie => cookie.name === 'moa_user')?.value
    expect(originalCookie).toBeTruthy()
    expect((await memberPage.request.get('/api/me')).status()).toBe(200)
    expect((await memberPage.request.get('/api/doc?slug=moa-design&doc=overview')).status()).toBe(200)
    const dialog = await openMembers(page)
    const memberRow = () => dialog.locator('div')
      .filter({ has: page.getByText('member@moa.example', { exact: true }) })
      .filter({ has: page.getByRole('button', { name: /^(Disable|Reactivate)$/ }) }).last()
    const confirmation = title => dialog.locator('div[tabindex="-1"]').filter({ has: page.getByText(title, { exact: true }) })

    await memberRow().getByRole('button', { name: 'Disable', exact: true }).click()
    const disabled = mutation(page, '/api/users/update', body => body.id === 'review-member' && body.disabled === true)
    await confirmation('Disable this account?').getByRole('button', { name: 'Disable', exact: true }).click()
    expect((await disabled).ok()).toBeTruthy()
    await expect(memberRow().getByText('Disabled', { exact: true })).toBeVisible()
    expect((await memberPage.request.get('/api/me')).status()).toBe(401)
    expect((await memberPage.request.get('/api/doc?slug=moa-design&doc=overview')).status()).toBe(401)
    expect((await (await page.request.get('/api/users')).json()).users.find(user => user.id === 'review-member').disabled).toBe(true)

    await memberRow().getByRole('button', { name: 'Reactivate', exact: true }).click()
    const reactivated = mutation(page, '/api/users/update', body => body.id === 'review-member' && body.disabled === false)
    await confirmation('Reactivate this account?').getByRole('button', { name: 'Reactivate', exact: true }).click()
    expect((await reactivated).ok()).toBeTruthy()
    await expect(memberRow().getByText('Member', { exact: true })).toBeVisible()
    expect((await memberPage.request.get('/api/me')).status()).toBe(200)
    expect((await memberPage.request.get('/api/doc?slug=moa-design&doc=overview')).status()).toBe(200)
    expect((await memberContext.cookies()).find(cookie => cookie.name === 'moa_user')?.value).toBe(originalCookie)

    await memberRow().getByRole('button', { name: 'Delete', exact: true }).click()
    const deleted = mutation(page, '/api/users/update', body => body.id === 'review-member' && body.remove === true)
    await confirmation('Delete this team member?').getByRole('button', { name: 'Delete account', exact: true }).click()
    expect((await deleted).ok()).toBeTruthy()
    await expect(dialog.getByText('member@moa.example', { exact: true })).toHaveCount(0)
    expect((await (await page.request.get('/api/users')).json()).users.some(user => user.id === 'review-member')).toBe(false)
    expect((await memberPage.request.get('/api/me')).status()).toBe(401)
    expect((await memberPage.request.get('/api/doc?slug=moa-design&doc=overview')).status()).toBe(401)
    expect((await memberContext.cookies()).find(cookie => cookie.name === 'moa_user')?.value).toBe(originalCookie)
  } finally {
    fs.writeFileSync(usersFile, usersBefore)
    await memberContext.close()
  }
})

test('search automatically reveals matching demos and shows an empty state only when nothing matches', async ({ page }) => {
  await login(page)
  const index = await fixtureIndex(page)
  const source = index.projects.find(project => project.slug === 'moa-design')
  const projects = [
    { ...source, slug: 'mock-normal-project', title: 'Routine project', description: 'A fictional regular project', status: 'active', demo: false },
    { ...source, slug: 'mock-demo-project', title: 'Unique demo preview', description: 'Only this demoonly description matches', status: 'active', demo: true, registered: false },
  ]
  await page.route('**/api/projects', route => route.fulfill({ json: { ...index, projects, hidden: [], registryProjects: [] } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Routine project', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Demo projects', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Unique demo preview', exact: true })).toHaveCount(0)
  const search = page.getByRole('searchbox', { name: 'Search projects', exact: true })
  const status = page.getByRole('combobox', { name: 'Project status', exact: true })
  await search.fill('DEMOONLY')
  await expect(page.getByRole('heading', { name: 'Unique demo preview', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Demo project list', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Project list', exact: true })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: /^1 project$/ })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'No matching projects', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Start a new chapter', exact: true })).toHaveCount(0)

  await search.fill('No project contains this phrase')
  await expect(page.getByRole('heading', { name: 'No matching projects', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^0 projects$/ })).toHaveCount(1)
  await expect(page.getByRole('list', { name: 'Demo project list', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(status).toHaveValue('all')
  await expect(page.getByRole('heading', { name: 'Routine project', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Demo projects', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await status.selectOption('paused')
  await expect(page.getByRole('heading', { name: 'No matching projects', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click()
  await expect(status).toHaveValue('all')
  await expect(page.getByRole('heading', { name: 'No matching projects', exact: true })).toHaveCount(0)
})
