import { test, expect, request } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { login } from './review-session.mjs'

// The search over every project (⌘K / Ctrl+K): one field finds a page of any project the reader may open, by
// its title or the words on the page, and opens it. Project and page titles are the Korean review fixtures.
const palette = page => page.getByRole('dialog', { name: 'Search documents', exact: true })
const field = page => palette(page).getByRole('combobox', { name: 'Search documents', exact: true })
const options = page => palette(page).getByRole('option')
const openDocument = async page => {
  await page.goto('/p/moa-design/overview')
  await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible()
}
const part = (option, name) => option.locator(`[data-part="${name}"]`)
const projectOf = option => part(option, 'project').textContent()
const projectsOf = async locator => new Set(await Promise.all((await locator.all()).map(projectOf)))

test('⌘K opens the search from a document, finds pages across projects by title and by text, and opens one', async ({ page }) => {
  await login(page)
  await openDocument(page)
  await expect(palette(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toBeVisible()
  await expect(field(page)).toBeFocused()
  // Before a query: the pages updated last, from every project.
  await expect(palette(page).getByText('Recent documents', { exact: true })).toBeVisible()
  expect(await options(page).count()).toBeGreaterThan(1)

  // A title found in several projects: every project's page is listed, the current project's first.
  await field(page).fill('관찰')
  await expect(palette(page).getByText(/^\d+ results$/)).toBeVisible()
  const found = options(page)
  expect(await found.count()).toBeGreaterThan(2)
  for (const title of await part(found, 'title').allTextContents()) expect(title).toBe('관찰과 배움')
  expect(await projectOf(found.first())).toBe('모아 디자인 리뉴얼')
  expect((await projectsOf(found)).size).toBeGreaterThan(1)
  await expect(part(found.first(), 'title').locator('mark')).toHaveText(['관찰'])
  await expect(found.first()).toHaveAttribute('aria-selected', 'true')

  // Words that occur only in the text of a page find it, with the passage around them.
  await field(page).fill('같은 맥락에서 다음 일을')
  await expect(part(found.first(), 'title')).toHaveText('더 명확하게, 더 편안하게')
  const excerpt = part(found.first(), 'excerpt')
  await expect(excerpt).toContainText('같은 맥락에서 다음 일을')
  expect(await excerpt.locator('mark').allTextContents()).toEqual(expect.arrayContaining(['같은', '맥락에서', '다음', '일을']))

  // Nothing matches: the search says so and keeps the query.
  await field(page).fill('이런 구절은 어느 문서에도 없습니다')
  await expect(palette(page).getByText('No documents match')).toBeVisible()
  await expect(options(page)).toHaveCount(0)

  // ↓ moves the selection, ↵ opens the selected page.
  await field(page).fill('관찰')
  await expect(found.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(found.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(found.first()).toHaveAttribute('aria-selected', 'false')
  expect(await field(page).getAttribute('aria-activedescendant')).toBe(await found.nth(1).getAttribute('id'))
  const target = await found.nth(1).getAttribute('href')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  await expect(page.getByRole('heading', { name: '작업의 흐름을 기록해요', exact: true })).toBeVisible()
})

test('the sidebar has an icon instead of a filter box, the icon opens the search, and Escape puts focus back', async ({ page }) => {
  await login(page)
  await openDocument(page)
  const sidebar = page.locator('aside').filter({ has: page.getByRole('combobox', { name: 'Switch project', exact: true }) })
  await expect(sidebar.getByRole('textbox')).toHaveCount(0)
  const icon = sidebar.getByRole('button', { name: 'Search documents', exact: true })
  await expect(icon).toBeVisible()
  await expect(icon).toHaveAttribute('title', /Search documents \((⌘K|Ctrl\+K)\)/)
  // The icon shares the row with the brand and the sidebar toggle, at the top of the sidebar.
  const [brand, button] = await Promise.all([sidebar.getByRole('link', { name: 'MOA project home', exact: true }).boundingBox(), icon.boundingBox()])
  expect(Math.abs(brand.y + brand.height / 2 - (button.y + button.height / 2))).toBeLessThan(8)
  expect(button.y).toBeLessThan(80)

  await icon.click()
  await expect(palette(page)).toBeVisible()
  await expect(field(page)).toBeFocused()
  await field(page).fill('url')
  await expect(part(options(page).first(), 'title')).toHaveText('아주 긴 한글 제목과 표 그리고 URL의 반응형 읽기 검수')
  await expect(part(options(page).first(), 'title').locator('mark')).toHaveText(['URL'])
  await page.keyboard.press('Escape')
  await expect(palette(page)).toHaveCount(0)
  await expect(icon).toBeFocused()

  // ⌘K also closes the search, and a reopened search starts clean.
  await page.keyboard.press('ControlOrMeta+k')
  await expect(field(page)).toHaveValue('')
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toHaveCount(0)

  // With the sidebar hidden, the icon moves to the header next to the brand.
  await sidebar.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await expect(sidebar).toHaveCount(0)
  const headerIcon = page.getByRole('button', { name: 'Search documents', exact: true }).locator('visible=true')
  await expect(headerIcon).toHaveCount(1)
  const [brandInHeader, iconInHeader] = await Promise.all([page.getByRole('link', { name: 'MOA project home', exact: true }).boundingBox(), headerIcon.boundingBox()])
  expect(iconInHeader.x).toBeGreaterThan(brandInHeader.x)
  expect(Math.abs(brandInHeader.y + brandInHeader.height / 2 - (iconInHeader.y + iconInHeader.height / 2))).toBeLessThan(8)
  await headerIcon.click()
  await expect(palette(page)).toBeVisible()
})

test('the hub opens the same search from its icon and the shortcut, and a page opens from there', async ({ page }) => {
  await login(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Search documents', exact: true }).click()
  await expect(palette(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette(page)).toHaveCount(0)
  // The toolbar's own box keeps filtering the project list; the shortcut still opens the search from it.
  await page.getByRole('searchbox', { name: 'Search projects', exact: true }).fill('브랜드')
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(field(page)).toBeFocused()
  await field(page).fill('다음 단계')
  await expect(part(options(page).first(), 'title')).toHaveText('다음 단계')
  await options(page).first().click()
  await expect(page).toHaveURL(/\/p\/[^/]+\/note-4$/)
  await expect(page.getByRole('heading', { name: '작업의 흐름을 기록해요', exact: true })).toBeVisible()
})

test('an invited reader searches only invited projects, and nobody searches without logging in', async ({ page, baseURL }) => {
  await login(page, 'member@moa.example')
  const response = await page.request.get('/api/search?q=관찰')
  expect(response.ok()).toBeTruthy()
  const data = await response.json()
  expect(data.results.length).toBeGreaterThan(0)
  expect(new Set(data.results.map(result => result.slug))).toEqual(new Set(['moa-design', 'brand-notes']))
  // The recent pages without a query are limited the same way.
  const recent = await (await page.request.get('/api/search')).json()
  expect(recent.results.length).toBeGreaterThan(0)
  expect(new Set(recent.results.map(result => result.slug))).toEqual(new Set(['moa-design', 'brand-notes']))

  await openDocument(page)
  await page.keyboard.press('ControlOrMeta+k')
  await field(page).fill('기록')
  await expect(options(page).first()).toBeVisible()
  expect([...await projectsOf(options(page))].sort()).toEqual(['모아 디자인 리뉴얼', '브랜드의 다음 장'].sort())

  const anonymous = await request.newContext({ baseURL })
  try {
    expect((await anonymous.get('/api/search?q=관찰')).status()).toBe(401)
  } finally { await anonymous.dispose() }
})

test('a share guest gets no search', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  try {
    await page.goto('/s/review-document-link-only')
    await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search documents', exact: true })).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toHaveCount(0)
    expect((await page.request.get('/api/search?q=관찰')).status()).toBe(401)
  } finally { await context.close() }
})

test('on a phone the header carries the search icon, and the search fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)
  await openDocument(page)
  const icon = page.getByRole('button', { name: 'Search documents', exact: true }).locator('visible=true')
  await expect(icon).toHaveCount(1)
  await icon.click()
  await expect(palette(page)).toBeVisible()
  await field(page).fill('관찰')
  await expect(options(page).first()).toBeVisible()
  const box = await palette(page).boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
})

test('the open search passes the WCAG checks', async ({ page }) => {
  await login(page)
  await openDocument(page)
  await page.keyboard.press('ControlOrMeta+k')
  await field(page).fill('관찰')
  await expect(options(page).first()).toBeVisible()
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations).toEqual([])
})
