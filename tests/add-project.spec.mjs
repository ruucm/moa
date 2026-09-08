import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { reviewRoot } from '../scripts/review-fixtures.mjs'
import { login } from './review-session.mjs'

const lstat = file => {
  try { return fs.lstatSync(file) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

test('가상 폴더를 실제 API로 연결하고 해제해도 원본 문서는 유지됨', async ({ page }) => {
  const slug = 'external-review-example'
  const source = path.join(reviewRoot, slug)
  const link = path.join(reviewRoot, 'projects', slug)
  const registryFile = path.join(reviewRoot, 'registry.json')
  const registryBefore = fs.readFileSync(registryFile)
  const documentFile = path.join(source, 'overview.mdx')
  const documentSource = `export const title = '프로젝트 연결 검수용 문서'
export const group = '검수 예시'
export const order = 1
export const date = '2026-09-07'

# 프로젝트 연결 검수용 문서

이 문서는 프로젝트 추가와 연결 해제를 확인하기 위한 가상 예시입니다.
`

  // Never replace or clean up a path that this test did not create.
  expect(lstat(source), 'The isolated example folder must be unused.').toBeNull()
  expect(lstat(link), 'The isolated project link must be unused.').toBeNull()
  expect(JSON.parse(registryBefore).projects.some(project => project.slug === slug)).toBe(false)
  let createdSource = false
  let browseRequests = 0
  const browseURL = url => url.pathname === '/api/browse'
  const browseFixture = async route => {
    browseRequests += 1
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
    await route.fulfill({
      json: {
        path: reviewRoot,
        parent: null,
        dirs: [{
          name: slug,
          path: source,
          mdxCount: 1,
          registered: registry.projects.some(project => project.slug === slug),
        }],
      },
    })
  }

  try {
    await login(page)
    const indexResponse = await page.request.get('/api/projects')
    expect(indexResponse.ok()).toBeTruthy()
    const index = await indexResponse.json()
    expect(index.projects.find(project => project.slug === 'moa-design')?.path)
      .toBe(path.join(reviewRoot, 'projects', 'moa-design'))

    fs.mkdirSync(source)
    createdSource = true
    fs.writeFileSync(documentFile, documentSource)
    // All browse requests are intercepted, including the refresh after adding.
    // Neither the initial favorite nor any actual external directory is read.
    await page.route(browseURL, browseFixture)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'New project', exact: true }).click()
    const addDialog = page.getByRole('dialog', { name: 'Add project', exact: true })
    await expect(addDialog).toBeVisible()
    await expect(addDialog.getByLabel('Folder path', { exact: true })).toHaveValue(reviewRoot)
    await expect(addDialog.getByText(slug, { exact: true })).toBeVisible()

    const added = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/add'
      && response.request().method() === 'POST'
      && response.request().postDataJSON().path === source)
    await addDialog.getByRole('button', { name: 'Add', exact: true }).click()
    expect((await added).ok()).toBeTruthy()
    const registered = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
    expect(registered.projects.find(project => project.slug === slug)).toMatchObject({ slug, path: source })
    expect(lstat(link)?.isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(link)).toBe(source)
    expect(fs.readFileSync(documentFile, 'utf8')).toBe(documentSource)

    // Keep the dialog open for consecutive additions and update this row's state.
    await expect(addDialog).toBeVisible()
    await expect(addDialog.getByText('Connected', { exact: true })).toBeVisible()
    await expect(addDialog.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0)
    expect(browseRequests).toBeGreaterThanOrEqual(2)
    await addDialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(addDialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: slug, exact: true })).toBeVisible()

    await page.locator(`a[href="/p/${slug}"]`).click()
    await expect(page.getByRole('heading', { name: '프로젝트 연결 검수용 문서', exact: true })).toBeVisible()
    await page.goto('/')
    await page.getByRole('button', { name: `${slug} project menu`, exact: true }).click()
    await page.getByRole('button', { name: 'Unregister', exact: true }).click()
    const removeDialog = page.getByRole('dialog', { name: 'Unregister this project?', exact: true })
    await expect(removeDialog).toBeVisible()
    const removed = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/remove'
      && response.request().method() === 'POST'
      && response.request().postDataJSON().slug === slug)
    await removeDialog.getByRole('button', { name: 'Unregister', exact: true }).click()
    expect((await removed).ok()).toBeTruthy()
    await expect(page.getByRole('heading', { name: slug, exact: true })).toHaveCount(0)
    expect(JSON.parse(fs.readFileSync(registryFile, 'utf8')).projects.some(project => project.slug === slug)).toBe(false)
    expect(lstat(link)).toBeNull()
    expect(fs.statSync(source).isDirectory()).toBe(true)
    expect(fs.readFileSync(documentFile, 'utf8')).toBe(documentSource)
  } finally {
    try {
      await page.unroute(browseURL, browseFixture)
    } finally {
      fs.writeFileSync(registryFile, registryBefore)
      if (createdSource) {
        if (lstat(link)?.isSymbolicLink() && fs.readlinkSync(link) === source) fs.unlinkSync(link)
        fs.rmSync(source, { recursive: true, force: true })
      }
    }
  }
})
