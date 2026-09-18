import { test, expect } from '@playwright/test'
import { login } from './review-session.mjs'

// The document list only scrolls once it overflows, so the project index is padded with fictional
// episode groups. They exist in the index only, never on disk, so only the real overview is rendered.
const sequential = Array.from({ length: 20 }, (_, index) => String(101 + index))
const pages = ['P · 기획원문', 'P0 · 대본', 'P1 · 스틸', 'P2 · 파일럿', 'P2.5 · 선조립', 'P3 · 전량', 'P3.5 · 재롤 판단', 'P4 · 조립', 'P5 · 완성본']
const groupName = number => `${number}: 검수용 에피소드 (가상 · 사이드바 스크롤 확인)`
const groupButton = number => new RegExp(`^${number}: `)
const lastEpisode = sequential.at(-1)
const lastPageSlug = `mock-episode-${lastEpisode}-p${pages.length - 1}`

// `episodes` is the default (order-meta) sequence; `updated` gives a group's newest file time.
const openLongProject = async (page, { episodes = sequential, expanded = [], updated = {}, doc = 'overview' } = {}) => {
  await login(page)
  await page.route('**/api/claude', route => route.fulfill({ json: { 'moa-design': { skills: [], agents: [] } } }))
  const response = await page.request.get('/api/projects')
  expect(response.ok()).toBeTruthy()
  const index = await response.json()
  const overview = index.projects.find(entry => entry.slug === 'moa-design').docs.find(entry => entry.slug === 'overview')
  const docs = [{ ...overview, group: '' }, ...episodes.flatMap((number, g) => pages.map((title, p) => ({
    slug: `mock-episode-${number}-p${p}`, title, group: groupName(number), order: g * 20 + p, mtime: updated[number] ? updated[number] - p * 1000 : null,
  })))]
  await page.route('**/api/projects', route => route.fulfill({ json: { ...index, projects: index.projects.map(entry => entry.slug === 'moa-design' ? { ...entry, docs } : entry) } }))
  const collapsed = episodes.filter(number => !expanded.includes(number)).map(groupName)
  await page.addInitScript(names => localStorage.setItem('hub.collapsed.moa-design', JSON.stringify(names)), collapsed)
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto(`/p/moa-design/${doc}`)
  const navigation = page.getByRole('navigation', { name: 'Project documents', exact: true })
  await expect(navigation.getByRole('link', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible()
  return navigation
}

const rect = locator => locator.evaluate(element => element.getBoundingClientRect().toJSON())
// Whether `locator` sits inside the visible box of the scrolling list (the window viewport is irrelevant).
const shownIn = async (navigation, locator) => {
  const [list, item] = await Promise.all([rect(navigation), rect(locator)])
  return item.top >= list.top && item.bottom <= list.bottom
}
const scrollTop = navigation => navigation.evaluate(nav => nav.scrollTop)
const scrollToEnd = navigation => navigation.evaluate(nav => { nav.scrollTop = nav.scrollHeight })
const groupOrder = navigation => navigation.locator('button[aria-expanded]').evaluateAll(buttons => buttons.map(button => button.textContent.split(':')[0]))

test('opening a group at the end of the list shows its pages instead of jumping back to the current document', async ({ page }) => {
  const navigation = await openLongProject(page)
  const current = navigation.getByRole('link', { name: '더 명확하게, 더 편안하게', exact: true })
  const last = navigation.getByRole('button', { name: groupButton(lastEpisode) })
  await expect(current).toHaveAttribute('aria-current', 'page')
  await expect(last).toHaveAttribute('aria-expanded', 'false')

  await scrollToEnd(navigation)
  expect(await shownIn(navigation, current)).toBe(false)
  expect(await shownIn(navigation, last)).toBe(true)
  await last.click()
  await expect(last).toHaveAttribute('aria-expanded', 'true')
  const lastPage = navigation.getByRole('link', { name: pages.at(-1), exact: true })
  await expect.poll(() => shownIn(navigation, lastPage), { message: 'the pages of the opened group come into view' }).toBe(true)
  expect(await shownIn(navigation, last)).toBe(true)
  expect(await shownIn(navigation, current)).toBe(false)

  // Closing the group again leaves the list where it is.
  await last.click()
  await expect(last).toHaveAttribute('aria-expanded', 'false')
  await page.waitForTimeout(500)
  expect(await shownIn(navigation, last)).toBe(true)
  expect(await shownIn(navigation, current)).toBe(false)
})

test('a group whose pages already fit does not move the list when opened or closed', async ({ page }) => {
  const navigation = await openLongProject(page)
  const first = navigation.getByRole('button', { name: groupButton(sequential[0]) })
  expect(await scrollTop(navigation)).toBe(0)
  await first.click()
  await expect(first).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: pages.at(-1), exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  expect(await scrollTop(navigation)).toBe(0)
  await first.click()
  await expect(first).toHaveAttribute('aria-expanded', 'false')
  await page.waitForTimeout(500)
  expect(await scrollTop(navigation)).toBe(0)
})

test('arriving on a page deep in the list still scrolls that page into view', async ({ page }) => {
  const navigation = await openLongProject(page, { expanded: [lastEpisode], doc: lastPageSlug })
  const current = navigation.getByRole('link', { name: pages.at(-1), exact: true })
  await expect(current).toHaveAttribute('aria-current', 'page')
  await expect.poll(() => shownIn(navigation, current), { message: 'the current page is scrolled into view on arrival' }).toBe(true)
  expect(await scrollTop(navigation)).toBeGreaterThan(0)
})

// The default order mirrors a real project whose order meta drifted as episodes were added over time.
const scrambled = ['105', '106', '110', '111', '112', '106-1', '100', '109', '120', '113', '118', '114', '117', '115', '119', '116', '101', '102', '103', '104']
const byName = ['100', '101', '102', '103', '104', '105', '106', '106-1', '109', '110', '111', '112', '113', '114', '115', '116', '117', '118', '119', '120']
const byUpdate = ['111', '100', '106-1', '109', '112', '105', '110', '106', '101', '120', '113', '118', '102', '114', '117', '103', '115', '119', '104', '116']
const updated = Object.fromEntries(byUpdate.map((number, index) => [number, Date.UTC(2026, 8, 18) - index * 3600000]))

test('groups can be sorted by name or by last update, and the choice is kept per project', async ({ page }) => {
  const navigation = await openLongProject(page, { episodes: scrambled, updated })
  const sortControl = page.getByRole('combobox', { name: 'Sort document groups', exact: true })
  await expect(sortControl).toHaveValue('order')
  expect(await groupOrder(navigation)).toEqual(scrambled)

  await scrollToEnd(navigation)
  await sortControl.selectOption('name')
  await expect.poll(() => groupOrder(navigation)).toEqual(byName)
  await expect.poll(() => scrollTop(navigation), { message: 'a new order is read from the top of the list' }).toBe(0)
  await expect(navigation.getByRole('link').first()).toHaveText('더 명확하게, 더 편안하게')
  expect(await page.evaluate(() => localStorage.getItem('hub.sort.moa-design'))).toBe('name')

  await page.reload()
  await expect(sortControl).toHaveValue('name')
  await expect.poll(() => groupOrder(navigation)).toEqual(byName)

  await sortControl.selectOption('recent')
  await expect.poll(() => groupOrder(navigation)).toEqual(byUpdate)

  await page.getByRole('combobox', { name: 'Switch project', exact: true }).selectOption('brand-notes')
  await expect(page).toHaveURL(/\/p\/brand-notes$/)
  await expect(page.getByRole('combobox', { name: 'Sort document groups', exact: true })).toHaveValue('order')
})
