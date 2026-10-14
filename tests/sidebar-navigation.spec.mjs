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
// `saved.groups` and `saved.pins` stand for the group order and the pinned pages stored for the project; the
// index reads them on every request. `member` opens the project as an invited reader, not an admin.
const openLongProject = async (page, { episodes = sequential, expanded = [], updated = {}, doc = 'overview', saved = {}, titles = pages, age = p => p * 1000, member = false } = {}) => {
  await login(page)
  await page.route('**/api/claude', route => route.fulfill({ json: { 'moa-design': { skills: [], agents: [] } } }))
  const response = await page.request.get('/api/projects')
  expect(response.ok()).toBeTruthy()
  const index = await response.json()
  const overview = index.projects.find(entry => entry.slug === 'moa-design').docs.find(entry => entry.slug === 'overview')
  const docs = [{ ...overview, group: '' }, ...episodes.flatMap((number, g) => titles.map((title, p) => ({
    slug: `mock-episode-${number}-p${p}`, title, group: groupName(number), order: g * 20 + p, mtime: updated[number] ? updated[number] - age(p) : null,
  })))]
  await page.route('**/api/projects', route => route.fulfill({ json: { ...index, owner: !member, member, projects: index.projects.map(entry => entry.slug === 'moa-design' ? { ...entry, docs, groupOrder: saved.groups, pins: saved.pins } : entry) } }))
  const collapsed = episodes.filter(number => !expanded.includes(number)).map(groupName)
  // Set once per test, so a reload keeps what the reader opened or closed since.
  await page.addInitScript(names => { if (localStorage.getItem('hub.collapsed.moa-design') === null) localStorage.setItem('hub.collapsed.moa-design', JSON.stringify(names)) }, collapsed)
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

// A reader pins a page with the pin at the end of its row. The reader's pinned pages gather in a Pinned group
// on top of the list, the latest pin first, and stay in their own groups too (saves mocked here).
const pageSlug = (number, p) => `mock-episode-${number}-p${p}`
const mockPins = async (page, saved, posts, respond = () => ({ json: { ok: true } })) => {
  await page.route('**/api/pin', async route => {
    const body = route.request().postDataJSON()
    posts.push(body)
    const reply = await respond(body)
    if (!reply.status) saved.pins = [...(body.pinned ? [body.doc] : []), ...(saved.pins || []).filter(slug => slug !== body.doc)]
    return route.fulfill(reply)
  })
}
// `has` takes a locator relative to each div, so it is made from the page, not from the list.
const pinnedGroup = navigation => navigation.locator('div').filter({ has: navigation.page().getByRole('button', { name: /^Pinned\s?\d+$/ }) }).last()
const pinnedTitles = navigation => pinnedGroup(navigation).locator('a').evaluateAll(links => links.map(link => link.firstChild.nextSibling.firstChild.textContent))
const rowIn = (scope, title) => scope.locator('div').filter({ has: scope.page().getByRole('link', { name: title, exact: true }) }).last()

test('pinning a page gathers it in a Pinned group on top of the list, and unpinning takes it out', async ({ page }) => {
  const saved = {}
  const posts = []
  await mockPins(page, saved, posts)
  const navigation = await openLongProject(page, { episodes: ['105', '106', '100'], expanded: ['106'], saved })
  const pinnedToggle = navigation.getByRole('button', { name: /^Pinned\s?\d+$/ })
  const episode = navigation.locator(`[data-group="${groupName('106')}"]`)
  await expect(pinnedToggle).toHaveCount(0)

  // The pin shows while the pointer is on the row; pressed, the page joins the Pinned group on top.
  const still = episode.getByRole('button', { name: 'Pin P1 · 스틸', exact: true })
  await expect(still).toHaveCSS('opacity', '0')
  await episode.getByRole('link', { name: 'P1 · 스틸', exact: true }).hover()
  await expect(still).toHaveCSS('opacity', '1')
  await still.click()
  await expect(pinnedToggle).toHaveText('Pinned1')
  expect(posts).toEqual([{ slug: 'moa-design', doc: pageSlug('106', 2), pinned: true }])
  expect(await navigation.locator('button[aria-expanded]').first().textContent()).toBe('Pinned1')
  // The Pinned group carries no mark of its own: its toggle shows only the caret.
  await expect(pinnedToggle.locator('svg')).toHaveCount(1)
  // It stays in its own group, where the pin stays in view to unpin it, and the Pinned row names that group.
  await expect(episode.getByRole('link', { name: 'P1 · 스틸', exact: true })).toBeVisible()
  await page.mouse.move(900, 600)
  const unpinStill = episode.getByRole('button', { name: 'Unpin P1 · 스틸', exact: true })
  await expect(unpinStill).toHaveCSS('opacity', '1')
  // A pinned page's pin is the same line icon, drawn in the accent colour rather than filled.
  await expect(unpinStill).toHaveCSS('color', 'rgb(166, 61, 18)')
  await expect(unpinStill.locator('svg')).toHaveCSS('fill', 'none')
  await expect(pinnedGroup(navigation).getByRole('link', { name: `P1 · 스틸 ${groupName('106')}`, exact: true })).toBeVisible()

  // The latest pin leads, and the Pinned group sits above the pages outside any group.
  await episode.getByRole('link', { name: 'P4 · 조립', exact: true }).hover()
  await episode.getByRole('button', { name: 'Pin P4 · 조립', exact: true }).click()
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P4 · 조립', 'P1 · 스틸'])
  const [pinned, loose] = await Promise.all([rect(pinnedGroup(navigation)), rect(navigation.getByRole('link', { name: '더 명확하게, 더 편안하게', exact: true }))])
  expect(pinned.bottom).toBeLessThanOrEqual(loose.top)
  await page.reload()
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P4 · 조립', 'P1 · 스틸'])

  // The Pinned group folds like any group, and remembers it.
  await pinnedToggle.click()
  await expect(pinnedToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(pinnedGroup(navigation).locator('a')).toHaveCount(0)
  await page.reload()
  await expect(pinnedToggle).toHaveAttribute('aria-expanded', 'false')
  await pinnedToggle.click()

  // A search keeps the pins it hides, and pins from the filtered list too.
  await page.getByLabel('Search documents').fill('105')
  await expect(pinnedToggle).toHaveCount(0)
  const other = navigation.locator(`[data-group="${groupName('105')}"]`)
  await other.getByRole('link', { name: 'P0 · 대본', exact: true }).hover()
  await other.getByRole('button', { name: 'Pin P0 · 대본', exact: true }).click()
  await expect(pinnedToggle).toHaveText('Pinned1')
  await page.getByLabel('Clear document search').click()
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P0 · 대본', 'P4 · 조립', 'P1 · 스틸'])

  // Unpinned from the Pinned group, a page leaves it; the last one takes the group with it.
  await rowIn(pinnedGroup(navigation), `P4 · 조립 ${groupName('106')}`).hover()
  await pinnedGroup(navigation).getByRole('button', { name: 'Unpin P4 · 조립', exact: true }).click()
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P0 · 대본', 'P1 · 스틸'])
  expect(posts.at(-1)).toEqual({ slug: 'moa-design', doc: pageSlug('106', 7), pinned: false })
  await expect(episode.getByRole('button', { name: 'Pin P4 · 조립', exact: true })).toHaveCount(1)
  for (const title of ['P0 · 대본', 'P1 · 스틸']) await pinnedGroup(navigation).getByRole('button', { name: `Unpin ${title}`, exact: true }).click()
  await expect(pinnedToggle).toHaveCount(0)
  expect(saved.pins).toEqual([])

  // A failed save takes the pin back and says why.
  await page.unroute('**/api/pin')
  await mockPins(page, saved, posts, () => ({ status: 500, json: { error: '검수용 저장 실패' } }))
  await episode.getByRole('link', { name: 'P2 · 파일럿', exact: true }).hover()
  await episode.getByRole('button', { name: 'Pin P2 · 파일럿', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '검수용 저장 실패' })).toBeVisible()
  await expect(pinnedToggle).toHaveCount(0)
  await expect(episode.getByRole('button', { name: 'Pin P2 · 파일럿', exact: true })).toHaveCount(1)
})

test('pins work from the keyboard, and focus stays on a pin', async ({ page }) => {
  const saved = { pins: [pageSlug('106', 0)] }
  const posts = []
  await mockPins(page, saved, posts)
  const navigation = await openLongProject(page, { episodes: ['105', '106'], expanded: ['106'], saved })
  const episode = navigation.locator(`[data-group="${groupName('106')}"]`)
  const pin = episode.getByRole('button', { name: 'Pin P2 · 파일럿', exact: true })
  await pin.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(pin).toHaveCSS('opacity', '1')
  await page.keyboard.press('Enter')
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P2 · 파일럿', 'P · 대본'])
  await expect(episode.getByRole('button', { name: 'Unpin P2 · 파일럿', exact: true })).toBeFocused()

  // Unpinned in the Pinned group, a page leaves it and focus moves to the pin that takes its place.
  await pinnedGroup(navigation).getByRole('button', { name: 'Unpin P2 · 파일럿', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P · 대본'])
  await expect(pinnedGroup(navigation).getByRole('button', { name: 'Unpin P · 대본', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(navigation.getByRole('button', { name: /^Pinned\s?\d+$/ })).toHaveCount(0)
  await expect(navigation.locator(':focus')).toHaveCount(1)
  expect(posts.map(post => post.pinned)).toEqual([true, false, false])
})

test('pins made while another is being saved are all saved, in order, and a double click pins once', async ({ page }) => {
  const saved = { pins: [pageSlug('106', 0)] }
  const posts = []
  let release
  const held = new Promise(resolve => { release = resolve })
  // The first save stays open until released, like a slow connection.
  await mockPins(page, saved, posts, async () => { if (posts.length === 1) await held; return { json: { ok: true } } })
  const navigation = await openLongProject(page, { episodes: ['105', '106'], expanded: ['106'], saved })
  const episode = navigation.locator(`[data-group="${groupName('106')}"]`)
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P · 대본'])
  // Every change shows at once: the unpinned page leaves, the pinned ones arrive, the latest first.
  await episode.getByRole('button', { name: 'Unpin P · 대본', exact: true }).click()
  await expect(navigation.getByRole('button', { name: /^Pinned\s?\d+$/ })).toHaveCount(0)
  for (const title of ['P0 · 대본', 'P3 · 전량', 'P5 · 완성본']) {
    await episode.getByRole('link', { name: title, exact: true }).hover()
    await episode.getByRole('button', { name: `Pin ${title}`, exact: true }).click()
  }
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P5 · 완성본', 'P3 · 전량', 'P0 · 대본'])
  expect(posts).toEqual([{ slug: 'moa-design', doc: pageSlug('106', 0), pinned: false }])
  release()
  await expect.poll(() => posts.map(post => post.doc)).toEqual([0, 1, 5, 8].map(p => pageSlug('106', p)))
  await page.waitForTimeout(300)
  expect(await pinnedTitles(navigation)).toEqual(['P5 · 완성본', 'P3 · 전량', 'P0 · 대본'])
  expect(saved.pins).toEqual([8, 5, 1].map(p => pageSlug('106', p)))

  // Pinning moves the list, so the second click of a double click may land on another page's pin; it is
  // not taken as a pin.
  await episode.getByRole('button', { name: 'Pin P2 · 파일럿', exact: true }).dispatchEvent('click', { detail: 2 })
  await page.waitForTimeout(300)
  expect(posts).toHaveLength(4)
  await episode.getByRole('button', { name: 'Pin P2 · 파일럿', exact: true }).dispatchEvent('click', { detail: 1 })
  await expect.poll(() => posts.length).toBe(5)
})

test('an invited reader pins pages for themselves too', async ({ page }) => {
  const saved = { pins: [pageSlug('106', 3), 'no-such-page', pageSlug('105', 0)] }
  const posts = []
  await mockPins(page, saved, posts)
  const navigation = await openLongProject(page, { episodes: ['105', '106'], expanded: ['106'], saved, member: true })
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P2 · 파일럿', 'P · 대본'])
  const episode = navigation.locator(`[data-group="${groupName('106')}"]`)
  await episode.getByRole('link', { name: 'P5 · 완성본', exact: true }).hover()
  await episode.getByRole('button', { name: 'Pin P5 · 완성본', exact: true }).click()
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P5 · 완성본', 'P2 · 파일럿', 'P · 대본'])
  expect(posts).toEqual([{ slug: 'moa-design', doc: pageSlug('106', 8), pinned: true }])
})

test('on a touch screen every pin stays in view as a full-size target', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    const saved = {}
    await mockPins(page, saved, [])
    await openLongProject(page, { episodes: ['105', '106'], expanded: ['106'], saved })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Open document navigation' }).tap()
    const navigation = page.getByRole('dialog').getByRole('navigation', { name: 'Project documents', exact: true })
    const pin = navigation.getByRole('button', { name: 'Pin P1 · 스틸', exact: true })
    await expect(pin).toHaveCSS('opacity', '1')
    const [button, label] = await Promise.all([rect(pin), rect(navigation.getByRole('link', { name: 'P1 · 스틸', exact: true }).locator('span'))])
    expect(Math.min(button.width, button.height)).toBeGreaterThanOrEqual(44)
    expect(label.right).toBeLessThanOrEqual(button.left)
    await pin.tap()
    await expect.poll(() => pinnedTitles(navigation)).toEqual(['P1 · 스틸'])
  } finally {
    await context.close()
  }
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

test('every account keeps its own pins, and a share guest gets none', async ({ page, browser, baseURL }) => {
  await login(page)
  const pinsFile = path.join(reviewRoot, 'pins.json')
  const pinsBefore = fs.existsSync(pinsFile) ? fs.readFileSync(pinsFile) : null
  const project = async request => (await (await request.get('/api/projects')).json()).projects.find(entry => entry.slug === 'moa-design')
  const pin = (request, doc, pinned, slug = 'moa-design') => request.post('/api/pin', { data: { slug, doc, pinned } })
  const member = await browser.newContext({ baseURL })
  const guest = await browser.newContext({ baseURL })
  try {
    fs.rmSync(pinsFile, { force: true })
    for (const doc of ['note-2', 'long-content', 'note-2']) expect((await pin(page.request, doc, true)).ok()).toBeTruthy()
    expect((await project(page.request)).pins).toEqual(['note-2', 'long-content'])
    expect((await pin(page.request, 'long-content', false)).ok()).toBeTruthy()
    expect((await pin(page.request, 'never-pinned', false)).ok()).toBeTruthy()
    expect((await project(page.request)).pins).toEqual(['note-2'])
    expect((await pin(page.request, 'no-such-page', true)).status()).toBe(404)
    expect((await pin(page.request, 'note-2', true, 'no-such-project')).status()).toBe(404)
    expect((await page.request.post('/api/pin', { data: { slug: 'moa-design', doc: 'note-2' } })).status()).toBe(400)

    // An invited reader starts with no pins, keeps their own, and pins only in invited projects.
    const memberPage = await member.newPage()
    await login(memberPage, 'member@moa.example')
    expect((await project(memberPage.request)).pins).toBeUndefined()
    expect((await pin(memberPage.request, 'long-content', true)).ok()).toBeTruthy()
    expect((await project(memberPage.request)).pins).toEqual(['long-content'])
    expect((await project(page.request)).pins).toEqual(['note-2'])
    expect((await pin(memberPage.request, 'overview', true, 'product-research')).status()).toBe(403)
    expect(JSON.parse(fs.readFileSync(pinsFile, 'utf8'))).toEqual({ 'user:review-admin': { 'moa-design': ['note-2'] }, 'user:review-member': { 'moa-design': ['long-content'] } })

    // A pin whose file is missing stays saved, out of the index until the file is back.
    fs.writeFileSync(pinsFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(pinsFile, 'utf8')), 'user:review-admin': { 'moa-design': ['gone-for-now', 'note-2'] } }))
    expect((await project(page.request)).pins).toEqual(['note-2'])

    // A share link is for one document: no pins go with it, and it cannot pin.
    const guestPage = await guest.newPage()
    await guestPage.goto('/s/review-document-link-only')
    await expect(guestPage.getByRole('heading', { name: '더 명확하게, 더 편안하게' })).toBeVisible()
    const shared = await project(guestPage.request)
    expect(shared.docs.map(entry => entry.slug)).toEqual(['overview'])
    expect(shared).not.toHaveProperty('pins')
    expect(shared).not.toHaveProperty('groupOrder')
    expect((await pin(guestPage.request, 'overview', true)).status()).toBe(401)

    // Unpinning an account's last page removes its entry.
    expect((await pin(memberPage.request, 'long-content', false)).ok()).toBeTruthy()
    expect(JSON.parse(fs.readFileSync(pinsFile, 'utf8'))).toEqual({ 'user:review-admin': { 'moa-design': ['gone-for-now', 'note-2'] } })
  } finally {
    if (pinsBefore) fs.writeFileSync(pinsFile, pinsBefore)
    else fs.rmSync(pinsFile, { force: true })
    await member.close()
    await guest.close()
  }
})
