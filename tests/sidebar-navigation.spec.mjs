import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { login } from './review-session.mjs'
import { reviewRoot } from '../scripts/review-fixtures.mjs'

// The document list only scrolls once it overflows, so the project index is padded with fictional
// episode groups. They exist in the index only, never on disk, so only the real overview is rendered.
const sequential = Array.from({ length: 20 }, (_, index) => String(101 + index))
const pages = ['P · 대본', 'P0 · 대본', 'P1 · 스틸', 'P2 · 파일럿', 'P2.5 · 선조립', 'P3 · 전량', 'P3.5 · 재롤 판단', 'P4 · 조립', 'P5 · 완성본']
const groupName = number => `${number}: 검수용 에피소드 (가상 · 사이드바 스크롤 확인)`
const groupButton = number => new RegExp(`^${number}: `)
const lastEpisode = sequential.at(-1)
const lastPageSlug = `mock-episode-${lastEpisode}-p${pages.length - 1}`

// `episodes` is the default (order-meta) sequence; `updated` gives a group's newest file time, and
// `age(p)` how much older than that its p-th page is. `titles` are the pages of every group.
// `saved.groups` stands for the group order stored for the project; the index reads it on every request.
const openLongProject = async (page, { episodes = sequential, expanded = [], updated = {}, doc = 'overview', saved = {}, titles = pages, age = p => p * 1000 } = {}) => {
  await login(page)
  await page.route('**/api/claude', route => route.fulfill({ json: { 'moa-design': { skills: [], agents: [] } } }))
  const response = await page.request.get('/api/projects')
  expect(response.ok()).toBeTruthy()
  const index = await response.json()
  const overview = index.projects.find(entry => entry.slug === 'moa-design').docs.find(entry => entry.slug === 'overview')
  const docs = [{ ...overview, group: '' }, ...episodes.flatMap((number, g) => titles.map((title, p) => ({
    slug: `mock-episode-${number}-p${p}`, title, group: groupName(number), order: g * 20 + p, mtime: updated[number] ? updated[number] - age(p) : null,
  })))]
  await page.route('**/api/projects', route => route.fulfill({ json: { ...index, projects: index.projects.map(entry => entry.slug === 'moa-design' ? { ...entry, docs, groupOrder: saved.groups } : entry) } }))
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
const updated = Object.fromEntries(scrambled.map((number, index) => [number, Date.UTC(2026, 8, 18) - index * 3600000]))
// Pages whose order meta is neither by title nor newest first: the second page is the newest.
const notes = ['다음 단계', '관찰과 배움', '작업 노트 2', '작업 노트 10']
const noteAge = p => [3, 1, 4, 2][p] * 60000

test('the sort menu orders the pages in each group, never the groups, and is kept per project', async ({ page }) => {
  const navigation = await openLongProject(page, { episodes: scrambled, expanded: ['105'], updated, titles: notes, age: noteAge })
  const sortControl = page.getByRole('combobox', { name: 'Sort pages in each group', exact: true })
  const pagesOf = number => navigation.locator(`[data-group="${groupName(number)}"] a`).allTextContents()
  await expect(sortControl).toHaveValue('order')
  expect(await groupOrder(navigation)).toEqual(scrambled)
  expect(await pagesOf('105')).toEqual(notes)

  await scrollToEnd(navigation)
  await sortControl.selectOption('name')
  await expect.poll(() => pagesOf('105')).toEqual(['관찰과 배움', '다음 단계', '작업 노트 2', '작업 노트 10'])
  expect(await groupOrder(navigation)).toEqual(scrambled)
  await expect.poll(() => scrollTop(navigation), { message: 'a new order is read from the top of the list' }).toBe(0)
  await expect(navigation.getByRole('link').first()).toHaveText('더 명확하게, 더 편안하게')
  expect(await page.evaluate(() => localStorage.getItem('hub.sort.moa-design'))).toBe('name')

  await page.reload()
  await expect(sortControl).toHaveValue('name')
  await expect.poll(() => pagesOf('105')).toEqual(['관찰과 배움', '다음 단계', '작업 노트 2', '작업 노트 10'])

  await sortControl.selectOption('recent')
  await expect.poll(() => pagesOf('105')).toEqual(['관찰과 배움', '작업 노트 10', '다음 단계', '작업 노트 2'])
  expect(await groupOrder(navigation)).toEqual(scrambled)

  await page.getByRole('combobox', { name: 'Switch project', exact: true }).selectOption('brand-notes')
  await expect(page).toHaveURL(/\/p\/brand-notes$/)
  await expect(page.getByRole('combobox', { name: 'Sort pages in each group', exact: true })).toHaveValue('order')
})

// An admin drags a group onto another group's place, or moves it with Alt+arrow keys. The order on
// screen is saved for the project (mocked here); the page sort menu has no part in it.
test('dragging groups saves the order on screen as the project group order', async ({ page }) => {
  const saved = {}
  const posts = []
  await page.route('**/api/order/groups', route => {
    const body = route.request().postDataJSON()
    posts.push(body)
    saved.groups = body.groups
    return route.fulfill({ json: { ok: true, count: body.groups.length } })
  })
  const navigation = await openLongProject(page, { episodes: ['105', '레퍼런스', '106', '100', '제작 시스템', '101'], saved })
  const group = name => navigation.getByRole('button', { name: groupButton(name) })
  const sortControl = page.getByRole('combobox', { name: 'Sort pages in each group', exact: true })
  await sortControl.selectOption('name')
  await expect(sortControl).toHaveValue('name')
  expect(await groupOrder(navigation)).toEqual(['105', '레퍼런스', '106', '100', '제작 시스템', '101'])
  await expect(group('제작 시스템')).toHaveAttribute('draggable', 'true')

  // Dropped on the first group, a group takes its place; the page sort stays as it was.
  const dragged = ['제작 시스템', '105', '레퍼런스', '106', '100', '101']
  await group('제작 시스템').dragTo(group('105'))
  await expect.poll(() => groupOrder(navigation)).toEqual(dragged)
  expect(posts).toEqual([{ slug: 'moa-design', groups: dragged.map(groupName) }])
  await expect(sortControl).toHaveValue('name')
  await page.reload()
  await expect.poll(() => groupOrder(navigation)).toEqual(dragged)

  // Alt+Down moves the focused group one place down and keeps focus on it.
  const moved = ['제작 시스템', '레퍼런스', '105', '106', '100', '101']
  await group('105').focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => groupOrder(navigation)).toEqual(moved)
  expect(posts.at(-1).groups).toEqual(moved.map(groupName))
  await expect(group('105')).toBeFocused()

  // A failed save puts the groups back and says why.
  await page.unroute('**/api/order/groups')
  await page.route('**/api/order/groups', route => route.fulfill({ status: 500, json: { error: '검수용 저장 실패' } }))
  await group('101').dragTo(group('제작 시스템'))
  await expect(page.getByRole('alert').filter({ hasText: '검수용 저장 실패' })).toBeVisible()
  await expect.poll(() => groupOrder(navigation)).toEqual(moved)

  // A search shows only part of the list, so its groups cannot be dragged.
  await page.getByLabel('Search documents').fill('105')
  await expect(group('105')).toBeVisible()
  await expect(group('105')).not.toHaveAttribute('draggable', 'true')
})

test('a group dragged from the end of a long list reaches the top while the list scrolls', async ({ page }) => {
  const saved = {}
  await page.route('**/api/order/groups', route => {
    saved.groups = route.request().postDataJSON().groups
    return route.fulfill({ json: { ok: true, count: saved.groups.length } })
  })
  const navigation = await openLongProject(page, { episodes: [...sequential, '레퍼런스'], saved })
  const last = navigation.getByRole('button', { name: groupButton('레퍼런스') })
  const first = navigation.getByRole('button', { name: groupButton(sequential[0]) })
  await scrollToEnd(navigation)
  expect(await shownIn(navigation, first)).toBe(false)

  // Held just above the list — past the edge where the browser's own drag scrolling stops — the drag
  // scrolls it up to the first group.
  const from = await last.boundingBox()
  const list = await navigation.boundingBox()
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, list.y - 10, { steps: 10 })
  await expect.poll(() => scrollTop(navigation), { message: 'the list scrolls while the pointer rests at its edge' }).toBe(0)
  const to = await first.boundingBox()
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => groupOrder(navigation)).toEqual(['레퍼런스', ...sequential])
  expect(saved.groups).toEqual(['레퍼런스', ...sequential].map(groupName))
})

test('the group order API keeps only the current groups of the project', async ({ page }) => {
  await login(page)
  const registryFile = path.join(reviewRoot, 'registry.json')
  const registryBefore = fs.readFileSync(registryFile)
  const savedOrder = async () => (await (await page.request.get('/api/projects')).json()).projects.find(entry => entry.slug === 'moa-design').groupOrder
  try {
    const response = await page.request.post('/api/order/groups', { data: { slug: 'moa-design', groups: ['작업 기록', '없는 그룹', '프로젝트 개요', '작업 기록', 7] } })
    expect(response.ok()).toBeTruthy()
    expect(await savedOrder()).toEqual(['작업 기록', '프로젝트 개요'])

    // An empty list goes back to the order meta.
    expect((await page.request.post('/api/order/groups', { data: { slug: 'moa-design', groups: [] } })).ok()).toBeTruthy()
    expect(await savedOrder()).toBeUndefined()

    expect((await page.request.post('/api/order/groups', { data: { slug: 'no-such-project', groups: [] } })).status()).toBe(404)
    expect((await page.request.post('/api/order/groups', { data: { slug: 'moa-design' } })).status()).toBe(400)
  } finally {
    fs.writeFileSync(registryFile, registryBefore)
  }
})
