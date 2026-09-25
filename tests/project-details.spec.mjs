import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { login } from './review-session.mjs'
import { reviewRoot } from '../scripts/review-fixtures.mjs'

// Editing a project's title and description from the hub. Registered fixture projects keep the
// change in registry.json, the local guide project in its _meta.json; both files are restored.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/claude', route => route.fulfill({ json: {} }))
})

const openHub = async page => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
}
const card = (page, title) => page.getByRole('list', { name: 'Project list', exact: true }).getByRole('listitem')
  .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const openEditor = async (page, title) => {
  await page.getByRole('button', { name: `${title} project menu`, exact: true }).click()
  await page.getByRole('button', { name: 'Edit details', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit project details', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
const update = (page, matches) => page.waitForResponse(response =>
  new URL(response.url()).pathname === '/api/projects/update' && response.request().method() === 'POST'
  && matches(response.request().postDataJSON()))

test('a registered project is renamed from its card menu, the hub and the reader follow, and the registry keeps it', async ({ page }) => {
  const registryFile = path.join(reviewRoot, 'registry.json')
  const registryBefore = fs.readFileSync(registryFile)
  try {
    await login(page)
    await openHub(page)
    const dialog = await openEditor(page, '브랜드의 다음 장')
    const title = dialog.getByLabel('Title', { exact: true })
    const description = dialog.getByLabel('Description', { exact: true })
    await expect(title).toBeFocused()
    await expect(title).toHaveValue('브랜드의 다음 장')
    await expect(description).toHaveValue('우리가 전하고 싶은 이야기와 시각 언어를 정리해요.')

    await title.fill('  브랜드   노트  ')
    await description.fill('검수용으로 바꾼   설명')
    const saved = update(page, body => body.slug === 'brand-notes')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await saved
    expect(response.ok()).toBeTruthy()
    expect(response.request().postDataJSON()).toEqual({ slug: 'brand-notes', title: '브랜드 노트', description: '검수용으로 바꾼 설명' })
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('“브랜드 노트” was updated.', { exact: true })).toBeVisible()
    await expect(card(page, '브랜드 노트')).toBeVisible()
    await expect(card(page, '브랜드 노트').getByText('검수용으로 바꾼 설명', { exact: true })).toBeVisible()
    await expect(card(page, '브랜드의 다음 장')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '브랜드 노트 project menu', exact: true })).toBeFocused()
    expect(JSON.parse(fs.readFileSync(registryFile, 'utf8')).projects.find(project => project.slug === 'brand-notes'))
      .toMatchObject({ slug: 'brand-notes', title: '브랜드 노트', description: '검수용으로 바꾼 설명' })

    await page.reload()
    await expect(card(page, '브랜드 노트')).toBeVisible()
    await page.goto('/p/brand-notes')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toContainText('브랜드 노트')
    await expect(page.getByRole('combobox', { name: 'Switch project', exact: true }).locator('option[value="brand-notes"]')).toHaveText('브랜드 노트')
  } finally {
    fs.writeFileSync(registryFile, registryBefore)
  }
})

test('an empty title cannot be saved, and cancelling leaves the project as it was', async ({ page }) => {
  let requests = 0
  await page.route('**/api/projects/update', route => { requests += 1; return route.continue() })
  await login(page)
  await openHub(page)
  const dialog = await openEditor(page, '제품 경험 리서치')
  const title = dialog.getByLabel('Title', { exact: true })
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  await title.fill('   ')
  await expect(dialog.getByRole('alert')).toHaveText('A title is required.')
  await expect(save).toBeDisabled()
  await title.press('Enter')
  await title.fill('임시 제목')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(save).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '제품 경험 리서치 project menu', exact: true })).toBeFocused()
  await expect(card(page, '제품 경험 리서치')).toBeVisible()
  await expect(card(page, '임시 제목')).toHaveCount(0)
  expect(requests).toBe(0)
})

test('a local project writes its new details to _meta.json, and an empty description hides the line', async ({ page }) => {
  const metaFile = path.join(reviewRoot, 'projects/guide/_meta.json')
  const metaBefore = fs.readFileSync(metaFile)
  try {
    await login(page)
    await openHub(page)
    await expect(card(page, 'MOA Design System').getByText('화면을 만드는 공통 기준과 실제 컴포넌트.', { exact: true })).toBeVisible()
    const dialog = await openEditor(page, 'MOA Design System')
    await dialog.getByLabel('Title', { exact: true }).fill('MOA 디자인 가이드')
    await dialog.getByLabel('Description', { exact: true }).fill('')
    const saved = update(page, body => body.slug === 'guide')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).ok()).toBeTruthy()
    await expect(card(page, 'MOA 디자인 가이드')).toBeVisible()
    await expect(card(page, 'MOA 디자인 가이드').locator('p')).toHaveCount(0)
    expect(JSON.parse(fs.readFileSync(metaFile, 'utf8'))).toEqual({ title: 'MOA 디자인 가이드', description: '', status: 'active', order: 70 })
    await page.reload()
    await expect(card(page, 'MOA 디자인 가이드')).toBeVisible()
  } finally {
    fs.writeFileSync(metaFile, metaBefore)
  }
})

test('the update API is admin-only and rejects unknown projects and bad input', async ({ page }) => {
  await login(page, 'member@moa.example')
  await openHub(page)
  await page.getByRole('button', { name: '모아 디자인 리뉴얼 project details', exact: true }).click()
  await expect(page.getByRole('group', { name: '모아 디자인 리뉴얼 project details', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit details', exact: true })).toHaveCount(0)
  expect((await page.request.post('/api/projects/update', { data: { slug: 'moa-design', title: '멤버가 바꾼 제목' } })).status()).toBe(403)

  await page.context().clearCookies()
  await login(page)
  const post = data => page.request.post('/api/projects/update', { data })
  expect((await post({ slug: 'no-such-project', title: '제목' })).status()).toBe(404)
  expect((await post({ slug: 'moa-design', title: '   ' })).status()).toBe(400)
  expect((await post({ slug: 'moa-design' })).status()).toBe(400)
  expect((await post({ slug: 'moa-design', title: 'x'.repeat(121) })).status()).toBe(400)
  expect((await post({ slug: 'moa-design', title: 42 })).status()).toBe(400)
  const index = await (await page.request.get('/api/projects')).json()
  expect(index.projects.find(project => project.slug === 'moa-design')).toMatchObject({ title: '모아 디자인 리뉴얼' })
})
