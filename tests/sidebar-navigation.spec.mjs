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
// `saved.groups` and `saved.pins` stand for the group order and the pinned pages stored for the project,
// `saved.archived` for its archived pages and groups ({ groups, docs }), and `saved.docs` for titles and groups
// saved in the pages' files ({ [slug]: { title?, group? } }); the index reads them on every request. `member` opens
// the project as an invited reader, not an admin.
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
  await page.route('**/api/projects', route => route.fulfill({ json: { ...index, owner: !member, member, projects: index.projects.map(entry => entry.slug === 'moa-design' ? { ...entry, docs: docs.map(doc => ({ ...doc, ...saved.docs?.[doc.slug] })), groupOrder: saved.groups, pins: saved.pins, archived: saved.archived } : entry) } }))
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
// The archived pages and groups saved for the project, as the archive API would keep them.
const mockArchive = async (page, saved, posts, respond = () => ({ json: { ok: true } })) => {
  await page.route('**/api/archive', async route => {
    const body = route.request().postDataJSON()
    posts.push(body)
    const reply = await respond(body)
    if (!reply.status) {
      const key = body.doc ? 'docs' : 'groups'
      const name = body.doc || body.group
      const list = (saved.archived?.[key] || []).filter(item => item !== name)
      saved.archived = { groups: [], docs: [], ...saved.archived, [key]: body.archived ? [...list, name] : list }
    }
    return route.fulfill(reply)
  })
}

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

  // A page pinned from another group — opened for it — leads the Pinned group as the latest pin.
  const other = navigation.locator(`[data-group="${groupName('105')}"]`)
  await other.getByRole('button', { name: groupButton('105') }).click()
  await other.getByRole('link', { name: 'P0 · 대본', exact: true }).hover()
  await other.getByRole('button', { name: 'Pin P0 · 대본', exact: true }).click()
  await expect(pinnedToggle).toHaveText('Pinned3')
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

test('on a touch screen every pin stays in view as a full-size target, and a long press opens the page menu', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    const saved = {}
    await mockPins(page, saved, [])
    await openLongProject(page, { episodes: ['105', '106'], expanded: ['106'], saved })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Open document navigation' }).tap()
    const navigation = page.getByRole('dialog').getByRole('navigation', { name: 'Project documents', exact: true })
    const link = navigation.getByRole('link', { name: 'P1 · 스틸', exact: true })
    const pin = navigation.getByRole('button', { name: 'Pin P1 · 스틸', exact: true })
    await expect(pin).toHaveCSS('opacity', '1')
    await expect(navigation.getByRole('button', { name: /^Rename / })).toHaveCount(0)
    const [button, label] = await Promise.all([rect(pin), rect(link.locator('span'))])
    expect(Math.round(Math.min(button.width, button.height))).toBeGreaterThanOrEqual(44)
    expect(label.right).toBeLessThanOrEqual(button.left + 0.5)

    // Half a second's press on a page opens its menu in the drawer; lifting the finger then does not open the page.
    const box = await rect(link)
    const touch = await context.newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.left + 60, y: box.top + box.height / 2 }] })
    const menu = page.getByRole('dialog').getByRole('menu', { name: 'P1 · 스틸', exact: true })
    await expect(menu).toBeVisible()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(400)
    await expect(menu).toBeVisible()
    expect(page.url()).toContain('/p/moa-design/overview')
    await menu.getByRole('menuitem', { name: 'Rename', exact: true }).tap()
    await expect(navigation.getByRole('textbox', { name: 'Title of P1 · 스틸', exact: true })).toBeFocused()
    // (Escape would close the drawer itself, as on any dialog.) Enter on the title as it was saves nothing.
    await page.keyboard.press('Enter')
    await expect(link).toBeVisible()

    await pin.tap()
    await expect.poll(() => pinnedTitles(navigation)).toEqual(['P1 · 스틸'])
  } finally {
    await context.close()
  }
})

// An admin drags a page onto another group, or moves it a group up or down with Alt+arrow keys, and edits its title
// from the page menu (a right click, a long press, or Shift+F10 on the link) or with F2. Each change is saved in the
// page's file (mocked here) and shows at once.
const mockPageSaves = async (page, saved, posts, respond = () => ({ json: { ok: true } })) => {
  await page.route('**/api/doc/update', async route => {
    const body = route.request().postDataJSON()
    posts.push(body)
    const reply = await respond(body)
    if (!reply.status) {
      const { slug, doc, ...change } = body
      saved.docs = { ...saved.docs, [doc]: { ...saved.docs?.[doc], ...change } }
    }
    return route.fulfill(reply)
  })
}
// The groups a page is listed in, outside the Pinned group (none while its group is closed).
const groupsOf = (navigation, slug) => navigation.evaluate((nav, slug) => [...nav.querySelectorAll('a[data-doc]')]
  .filter(link => link.dataset.doc === slug && link.closest('[data-group]'))
  .map(link => link.closest('[data-group]').dataset.group), slug)
const pageLink = (navigation, slug) => navigation.locator(`[data-group] a[data-doc="${slug}"]`)

test('dragging a page onto another group moves it there and saves its group', async ({ page }) => {
  const saved = {}
  const posts = []
  await mockPageSaves(page, saved, posts)
  const navigation = await openLongProject(page, { episodes: ['105', '106', '100'], expanded: ['106'], saved })
  const toggle = number => navigation.getByRole('button', { name: groupButton(number) })
  const still = pageSlug('106', 2)
  await expect(pageLink(navigation, still)).toHaveAttribute('draggable', 'true')

  // Dropped on a closed group, the page joins it and the group opens to show it there.
  await pageLink(navigation, still).dragTo(toggle('105'))
  await expect(toggle('105')).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => groupsOf(navigation, still)).toEqual([groupName('105')])
  await expect(toggle('105')).toHaveText(`${groupName('105')}${pages.length + 1}`)
  await expect(toggle('106')).toHaveText(`${groupName('106')}${pages.length - 1}`)
  await expect.poll(() => posts).toEqual([{ slug: 'moa-design', doc: still, group: groupName('105') }])
  await page.reload()
  await expect.poll(() => groupsOf(navigation, still)).toEqual([groupName('105')])

  // Dropped on the group it is in, or outside any group, it stays where it is.
  await pageLink(navigation, still).dragTo(toggle('105'))
  await pageLink(navigation, pageSlug('106', 0)).dragTo(navigation.getByRole('link', { name: '더 명확하게, 더 편안하게', exact: true }))
  await page.waitForTimeout(300)
  expect(posts).toHaveLength(1)
  expect(await groupsOf(navigation, pageSlug('106', 0))).toEqual([groupName('106')])

  // A page in the Pinned group can be dragged too; it stays pinned, under its new group's name.
  saved.pins = [pageSlug('106', 3)]
  await page.reload()
  const pinned = pinnedGroup(navigation).locator('a').first()
  await pinned.dragTo(toggle('105'))
  await expect.poll(() => groupsOf(navigation, pageSlug('106', 3))).toEqual([groupName('105')])
  await expect(pinned).toHaveText(`P2 · 파일럿 ${groupName('105')}`)
  await expect.poll(() => posts.at(-1)).toEqual({ slug: 'moa-design', doc: pageSlug('106', 3), group: groupName('105') })

  // A failed save puts the page back and says why. (105 closes first, so both ends of the drag fit in the list.)
  await page.unroute('**/api/doc/update')
  await mockPageSaves(page, saved, posts, () => ({ status: 500, json: { error: '검수용 저장 실패' } }))
  await toggle('105').click()
  await expect(toggle('105')).toHaveAttribute('aria-expanded', 'false')
  await pageLink(navigation, pageSlug('106', 5)).dragTo(toggle('105'))
  await expect(page.getByRole('alert').filter({ hasText: '검수용 저장 실패' })).toBeVisible()
  await expect.poll(() => groupsOf(navigation, pageSlug('106', 5))).toEqual([groupName('106')])
})

test('a page moves a group up or down and is renamed from the keyboard, keeping focus', async ({ page }) => {
  const saved = {}
  const posts = []
  await mockPageSaves(page, saved, posts)
  const navigation = await openLongProject(page, { episodes: ['105', '106', '100'], expanded: ['105', '106'], saved })
  const pilot = pageSlug('106', 3)

  // Alt+Down moves it into the next group, which opens; focus goes along.
  await pageLink(navigation, pilot).focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => groupsOf(navigation, pilot)).toEqual([groupName('100')])
  await expect(pageLink(navigation, pilot)).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => groupsOf(navigation, pilot)).toEqual([groupName('106')])
  await expect(pageLink(navigation, pilot)).toBeFocused()
  await expect.poll(() => posts).toEqual([groupName('100'), groupName('106')].map(group => ({ slug: 'moa-design', doc: pilot, group })))
  // There is no group above the first one.
  await pageLink(navigation, pageSlug('105', 0)).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForTimeout(300)
  expect(posts).toHaveLength(2)

  // F2 opens the title for editing; Enter saves it and gives focus back to the page.
  await pageLink(navigation, pilot).focus()
  await page.keyboard.press('F2')
  const field = navigation.getByRole('textbox', { name: 'Title of P2 · 파일럿', exact: true })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('P2 · 파일럿')
  await page.keyboard.type('P2 · 파일럿   (2차) ')
  await page.keyboard.press('Enter')
  await expect(pageLink(navigation, pilot)).toHaveText('P2 · 파일럿 (2차)')
  await expect(pageLink(navigation, pilot)).toBeFocused()
  await expect.poll(() => posts.at(-1)).toEqual({ slug: 'moa-design', doc: pilot, title: 'P2 · 파일럿 (2차)' })

  // Escape keeps the title as it was.
  await page.keyboard.press('F2')
  await page.keyboard.type('버릴 제목')
  await page.keyboard.press('Escape')
  await expect(pageLink(navigation, pilot)).toHaveText('P2 · 파일럿 (2차)')
  await expect(pageLink(navigation, pilot)).toBeFocused()
  await page.waitForTimeout(300)
  expect(posts).toHaveLength(3)
})

test('the page menu, from a right click or Shift+F10, renames a page or pins it; a failed save puts the old title back', async ({ page }) => {
  const saved = {}
  const posts = []
  const pins = []
  await mockPageSaves(page, saved, posts)
  await mockPins(page, saved, pins)
  const navigation = await openLongProject(page, { episodes: ['105', '106'], expanded: ['106'], saved })
  const episode = navigation.locator(`[data-group="${groupName('106')}"]`)
  const still = episode.getByRole('link', { name: 'P1 · 스틸', exact: true })
  const menu = page.getByRole('menu', { name: 'P1 · 스틸', exact: true })
  const near = (a, b) => Math.abs(a - b) <= 1

  // Nothing but the pin shows on the row. A right click opens the menu where the pointer is.
  await still.hover()
  await expect(navigation.getByRole('button', { name: /^Rename / })).toHaveCount(0)
  await expect(menu).toHaveCount(0)
  await still.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused()
  await expect(menu.getByRole('menuitem', { name: 'Pin to the top', exact: true })).toBeVisible()
  const [panel, target] = await Promise.all([rect(menu), rect(still)])
  expect(near(panel.left, target.left + target.width / 2) && near(panel.top, target.top + target.height / 2)).toBe(true)
  // Escape closes it, with focus back on the link.
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(still).toBeFocused()

  // Shift+F10 opens it by the link; the arrow keys move through it, around its ends, and Enter pins the page.
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused()
  const byLink = await rect(menu)
  expect(byLink.left).toBeGreaterThan(target.left)
  expect(byLink.left).toBeLessThan(target.right)
  expect(byLink.top).toBeGreaterThan(target.top)
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Pin to the top', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Archive', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P1 · 스틸'])
  expect(pins).toEqual([{ slug: 'moa-design', doc: pageSlug('106', 2), pinned: true }])
  await expect(still).toBeFocused()

  // A pinned page offers to unpin; a click elsewhere closes the menu.
  await still.click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
  await page.mouse.click(900, 600)
  await expect(menu).toHaveCount(0)

  // Rename opens the title in its field; leaving the field saves it.
  const rename = async (name) => {
    await episode.getByRole('link', { name, exact: true }).click({ button: 'right' })
    await page.getByRole('menu', { name, exact: true }).getByRole('menuitem', { name: 'Rename', exact: true }).click()
  }
  await rename('P1 · 스틸')
  const field = episode.getByRole('textbox', { name: 'Title of P1 · 스틸', exact: true })
  await expect(field).toBeFocused()
  await expect(menu).toHaveCount(0)
  await field.fill('스틸 컷 · 확정')
  await page.mouse.click(900, 600)
  await expect(episode.getByRole('link', { name: '스틸 컷 · 확정', exact: true })).toBeVisible()
  await expect(field).toHaveCount(0)
  await expect.poll(() => posts).toEqual([{ slug: 'moa-design', doc: pageSlug('106', 2), title: '스틸 컷 · 확정' }])
  await page.reload()
  await expect(episode.getByRole('link', { name: '스틸 컷 · 확정', exact: true })).toBeVisible()

  // A title left as it was, or emptied, saves nothing.
  for (const value of [null, '   ']) {
    await rename('스틸 컷 · 확정')
    if (value !== null) await episode.getByRole('textbox').fill(value)
    await page.keyboard.press('Enter')
    await expect(episode.getByRole('link', { name: '스틸 컷 · 확정', exact: true })).toBeVisible()
  }
  await page.waitForTimeout(300)
  expect(posts).toHaveLength(1)

  await page.unroute('**/api/doc/update')
  await mockPageSaves(page, saved, posts, () => ({ status: 500, json: { error: '검수용 저장 실패' } }))
  await rename('P2 · 파일럿')
  await episode.getByRole('textbox').fill('저장 안 될 제목')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: '검수용 저장 실패' })).toBeVisible()
  await expect(episode.getByRole('link', { name: 'P2 · 파일럿', exact: true })).toBeVisible()
  await expect(episode.getByRole('link', { name: '저장 안 될 제목', exact: true })).toHaveCount(0)
})

test('a page or a whole group is archived from its menu into an Archived group at the end of the list, and brought back from there', async ({ page }) => {
  const saved = {}
  const posts = []
  const pins = []
  await mockArchive(page, saved, posts)
  await mockPins(page, saved, pins)
  const navigation = await openLongProject(page, { episodes: ['105', '106', '100'], expanded: ['106', '100'], saved })
  const mainToggle = number => navigation.locator(`[data-group="${groupName(number)}"]`).getByRole('button', { name: groupButton(number) })
  const archivedToggle = navigation.getByRole('button', { name: /^Archived\s?\d+$/ })
  const archivedGroup = navigation.locator('div').filter({ has: page.getByRole('button', { name: /^Archived\s?\d+$/ }) }).last()
  const archivedSub = number => archivedGroup.locator(`[data-archived-group="${groupName(number)}"]`)
  const menuOf = async (locator, name) => { await locator.click({ button: 'right' }); return page.getByRole('menu', { name, exact: true }) }
  const still = pageSlug('106', 2)
  await expect(archivedToggle).toHaveCount(0)

  // Archived from its menu, a page leaves its group for the Archived group, which starts closed and takes focus.
  await (await menuOf(pageLink(navigation, still), 'P1 · 스틸')).getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(pageLink(navigation, still)).toHaveCount(0)
  await expect(mainToggle('106')).toHaveText(`${groupName('106')}${pages.length - 1}`)
  await expect(archivedToggle).toHaveText('Archived1')
  await expect(archivedToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(archivedToggle).toBeFocused()
  expect(posts).toEqual([{ slug: 'moa-design', doc: still, archived: true }])
  expect(await groupOrder(navigation)).toEqual(['105', '106', '100', 'Archived1'])

  // It is listed there with the name of its group and without a pin; its menu offers to bring it back, not to pin it.
  await archivedToggle.click()
  const archivedLink = archivedGroup.getByRole('link', { name: `P1 · 스틸 ${groupName('106')}`, exact: true })
  await expect(archivedLink).toBeVisible()
  await expect(archivedGroup.getByRole('button', { name: /^Pin / })).toHaveCount(0)
  const menu = await menuOf(archivedLink, 'P1 · 스틸')
  await expect(menu.getByRole('menuitem')).toHaveCount(2)
  await expect(menu.getByRole('menuitem', { name: 'Unarchive', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(archivedToggle).toHaveText('Archived1')
  await expect(archivedLink).toBeVisible()

  // A whole group goes in from its heading's menu, with its pages, open as it was; its page's menu acts on the group.
  await (await menuOf(mainToggle('100'), groupName('100'))).getByRole('menuitem', { name: 'Archive group', exact: true }).click()
  await expect(mainToggle('100')).toHaveCount(0)
  await expect(archivedToggle).toHaveText(`Archived${pages.length + 1}`)
  await expect(archivedToggle).toBeFocused()
  expect(posts.at(-1)).toEqual({ slug: 'moa-design', group: groupName('100'), archived: true })
  await expect(archivedSub('100').getByRole('button', { name: groupButton('100') })).toHaveAttribute('aria-expanded', 'true')
  const inGroup = archivedSub('100').getByRole('link', { name: 'P1 · 스틸', exact: true })
  await expect(inGroup).toBeVisible()
  await expect((await menuOf(inGroup, 'P1 · 스틸')).getByRole('menuitem', { name: 'Unarchive group', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(mainToggle('100')).toHaveCount(0)
  await expect(inGroup).toBeVisible()

  // Brought back from its menu, a group returns to its place, and focus goes with it.
  await (await menuOf(archivedSub('100').getByRole('button', { name: groupButton('100') }), groupName('100'))).getByRole('menuitem', { name: 'Unarchive group', exact: true }).click()
  await expect(mainToggle('100')).toBeVisible()
  await expect(mainToggle('100')).toBeFocused()
  expect(await groupOrder(navigation)).toEqual(['105', '106', '100', 'Archived1'])
  expect(posts.at(-1)).toEqual({ slug: 'moa-design', group: groupName('100'), archived: false })

  // So does a page, into its group; with nothing left in it, the Archived group goes.
  await (await menuOf(archivedLink, 'P1 · 스틸')).getByRole('menuitem', { name: 'Unarchive', exact: true }).click()
  await expect(pageLink(navigation, still)).toBeVisible()
  await expect(pageLink(navigation, still)).toBeFocused()
  await expect(archivedToggle).toHaveCount(0)
  expect(posts.at(-1)).toEqual({ slug: 'moa-design', doc: still, archived: false })

  // A pinned page that is archived leaves the Pinned group too, and comes back to it.
  await pageLink(navigation, still).hover()
  await navigation.locator(`[data-group="${groupName('106')}"]`).getByRole('button', { name: 'Pin P1 · 스틸', exact: true }).click()
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P1 · 스틸'])
  await (await menuOf(pageLink(navigation, still), 'P1 · 스틸')).getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await expect(pinnedGroup(navigation)).toHaveCount(0)
  await expect(archivedToggle).toHaveText('Archived1')
  await (await menuOf(archivedLink, 'P1 · 스틸')).getByRole('menuitem', { name: 'Unarchive', exact: true }).click()
  await expect.poll(() => pinnedTitles(navigation)).toEqual(['P1 · 스틸'])
  await expect(archivedToggle).toHaveCount(0)

  // A failed save puts things back and says why.
  await page.unroute('**/api/archive')
  await mockArchive(page, saved, posts, () => ({ status: 500, json: { error: '검수용 저장 실패' } }))
  await (await menuOf(mainToggle('105'), groupName('105'))).getByRole('menuitem', { name: 'Archive group', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '검수용 저장 실패' })).toBeVisible()
  await expect(mainToggle('105')).toBeVisible()
  await expect(archivedToggle).toHaveCount(0)
})

test('an invited reader cannot rename, move or archive pages, and sees what is archived', async ({ page }) => {
  const saved = { archived: { docs: [pageSlug('106', 2)], groups: [groupName('105')] } }
  const navigation = await openLongProject(page, { episodes: ['105', '106'], expanded: ['106'], member: true, saved })
  const link = pageLink(navigation, pageSlug('106', 3))
  await link.hover()
  await expect(navigation.getByRole('button', { name: /^Rename / })).toHaveCount(0)
  await expect(link).not.toHaveAttribute('draggable', 'true')
  await link.click({ button: 'right' })
  await page.waitForTimeout(300)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await link.focus()
  await page.keyboard.press('F2')
  await expect(navigation.getByRole('textbox')).toHaveCount(0)
  await page.keyboard.press('Shift+F10')
  await page.waitForTimeout(300)
  await expect(page.getByRole('menu')).toHaveCount(0)

  // The archived page and group are in the Archived group, out of the list, without a menu.
  const archivedToggle = navigation.getByRole('button', { name: /^Archived\s?\d+$/ })
  await expect(archivedToggle).toHaveText(`Archived${pages.length + 1}`)
  await expect(navigation.locator(`[data-group="${groupName('105')}"]`)).toHaveCount(0)
  await expect(pageLink(navigation, pageSlug('106', 2))).toHaveCount(0)
  await archivedToggle.click()
  const archivedGroup = navigation.locator(`[data-archived-group="${groupName('105')}"]`)
  await expect(archivedGroup).toBeVisible()
  await expect(navigation.getByRole('link', { name: `P1 · 스틸 ${groupName('106')}`, exact: true })).toBeVisible()
  await archivedGroup.getByRole('button', { name: groupButton('105') }).click({ button: 'right' })
  await page.waitForTimeout(300)
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('the page API rewrites only the title or group literal of the file', async ({ page, browser, baseURL }) => {
  await login(page)
  const file = path.join(reviewRoot, 'projects', 'moa-design', 'note-2.mdx')
  const loose = path.join(reviewRoot, 'projects', 'guide', 'runtime-error.mdx')
  const [before, looseBefore] = [fs.readFileSync(file, 'utf8'), fs.readFileSync(loose, 'utf8')]
  const update = (data, request = page.request) => request.post('/api/doc/update', { data })
  const indexed = async (slug, doc) => (await (await page.request.get('/api/projects')).json()).projects.find(entry => entry.slug === slug).docs.find(entry => entry.slug === doc)
  const member = await browser.newContext({ baseURL })
  const guest = await browser.newContext({ baseURL })
  try {
    // A move changes the group literal where it stands, nothing else.
    let response = await update({ slug: 'moa-design', doc: 'note-2', group: '검수' })
    expect(response.ok()).toBeTruthy()
    expect(await response.json()).toEqual({ ok: true, doc: { slug: 'note-2', title: '관찰과 배움', group: '검수' } })
    expect(fs.readFileSync(file, 'utf8')).toBe(before.replace("export const group = '작업 기록'", "export const group = '검수'"))
    expect(await indexed('moa-design', 'note-2')).toMatchObject({ title: '관찰과 배움', group: '검수', order: 2, date: '2026-09-02' })

    // A title is kept on one line, between quotes it doesn't contain.
    expect((await update({ slug: 'moa-design', doc: 'note-2', title: `  It's\n "done"  ` })).ok()).toBeTruthy()
    expect(fs.readFileSync(file, 'utf8')).toContain('export const title = `It\'s "done"`')
    expect(await indexed('moa-design', 'note-2')).toMatchObject({ title: `It's "done"`, group: '검수' })
    // The same text again leaves the file alone.
    const { mtimeMs } = fs.statSync(file)
    expect((await update({ slug: 'moa-design', doc: 'note-2', title: `It's "done"`, group: '검수' })).ok()).toBeTruthy()
    expect(fs.statSync(file).mtimeMs).toBe(mtimeMs)
    // Back to the old title and group, the file is as it was.
    expect((await update({ slug: 'moa-design', doc: 'note-2', title: '관찰과 배움', group: '작업 기록' })).ok()).toBeTruthy()
    expect(fs.readFileSync(file, 'utf8')).toBe(before)

    // A page without a group gets one, on the line after its title.
    expect((await update({ slug: 'guide', doc: 'runtime-error', group: '오류 검수' })).ok()).toBeTruthy()
    expect(fs.readFileSync(loose, 'utf8')).toBe(looseBefore.replace("export const title = '렌더 오류 검수'\n", "export const title = '렌더 오류 검수'\nexport const group = '오류 검수'\n"))
    expect(await indexed('guide', 'runtime-error')).toMatchObject({ title: '렌더 오류 검수', group: '오류 검수', order: 98 })

    for (const [data, status] of [
      [{ slug: 'moa-design', doc: 'note-2' }, 400],
      [{ slug: 'moa-design', doc: 'note-2', title: '  ' }, 400],
      [{ slug: 'moa-design', doc: 'note-2', title: 'a\\b' }, 400],
      [{ slug: 'moa-design', doc: 'note-2', group: 7 }, 400],
      [{ slug: 'moa-design', doc: 'note-2', title: 'x'.repeat(201) }, 400],
      [{ slug: 'moa-design', doc: 'note-2', title: '`${a}` \'b\' "c"' }, 422],
      [{ slug: 'moa-design', doc: 'no-such-page', title: 'x' }, 404],
      [{ slug: 'no-such-project', doc: 'note-2', title: 'x' }, 404],
    ]) expect((await update(data)).status(), JSON.stringify(data)).toBe(status)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)

    // Only an admin edits pages.
    const memberPage = await member.newPage()
    await login(memberPage, 'member@moa.example')
    expect((await update({ slug: 'moa-design', doc: 'note-2', title: 'x' }, memberPage.request)).status()).toBe(403)
    expect((await update({ slug: 'moa-design', doc: 'note-2', title: 'x' }, (await guest.newPage()).request)).status()).toBe(401)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
  } finally {
    fs.writeFileSync(file, before)
    fs.writeFileSync(loose, looseBefore)
    await member.close()
    await guest.close()
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

test('the archive API keeps the archived pages and groups of a project in the registry', async ({ page, browser, baseURL }) => {
  await login(page)
  const registryFile = path.join(reviewRoot, 'registry.json')
  const registryBefore = fs.readFileSync(registryFile)
  const archivedOf = async (request = page.request) => (await (await request.get('/api/projects')).json()).projects.find(entry => entry.slug === 'moa-design').archived
  const archive = (data, request = page.request) => request.post('/api/archive', { data })
  const member = await browser.newContext({ baseURL })
  try {
    expect((await archive({ slug: 'moa-design', doc: 'note-2', archived: true })).ok()).toBeTruthy()
    expect((await archive({ slug: 'moa-design', group: '검수', archived: true })).ok()).toBeTruthy()
    expect((await archive({ slug: 'moa-design', doc: 'note-2', archived: true })).ok()).toBeTruthy()
    expect(await archivedOf()).toEqual({ groups: ['검수'], docs: ['note-2'] })
    expect(JSON.parse(fs.readFileSync(registryFile, 'utf8')).archived).toEqual({ 'moa-design': { groups: ['검수'], docs: ['note-2'] } })

    // An invited reader sees what is archived and cannot change it.
    const memberPage = await member.newPage()
    await login(memberPage, 'member@moa.example')
    expect(await archivedOf(memberPage.request)).toEqual({ groups: ['검수'], docs: ['note-2'] })
    expect([401, 403]).toContain((await archive({ slug: 'moa-design', doc: 'overview', archived: true }, memberPage.request)).status())

    expect((await archive({ slug: 'moa-design', doc: 'no-such-page', archived: true })).status()).toBe(404)
    expect((await archive({ slug: 'moa-design', group: '없는 그룹', archived: true })).status()).toBe(404)
    expect((await archive({ slug: 'no-such-project', doc: 'note-2', archived: true })).status()).toBe(404)
    expect((await archive({ slug: 'moa-design', doc: 'note-2' })).status()).toBe(400)
    expect((await archive({ slug: 'moa-design', doc: 'note-2', group: '검수', archived: true })).status()).toBe(400)
    expect((await archive({ slug: 'moa-design', group: '', archived: true })).status()).toBe(400)
    expect(await archivedOf()).toEqual({ groups: ['검수'], docs: ['note-2'] })

    // Bringing everything back, even what was never archived, empties the entry.
    expect((await archive({ slug: 'moa-design', doc: 'note-2', archived: false })).ok()).toBeTruthy()
    expect((await archive({ slug: 'moa-design', group: '검수', archived: false })).ok()).toBeTruthy()
    expect((await archive({ slug: 'moa-design', doc: 'never-archived', archived: false })).ok()).toBeTruthy()
    expect(await archivedOf()).toBeUndefined()
    expect(JSON.parse(fs.readFileSync(registryFile, 'utf8'))).not.toHaveProperty('archived')
  } finally {
    fs.writeFileSync(registryFile, registryBefore)
    await member.close()
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
