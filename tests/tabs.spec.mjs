import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { login } from './review-session.mjs'

// moa's own tabs (lib/tabs.js · features/tabs): a page opened in a new tab joins a strip across the top of the window,
// which shows only while the window holds two tabs or more. Titles are the Korean review fixtures of moa-design.
const overview = '더 명확하게, 더 편안하게'
const note = '관찰과 배움'
const noteHeading = '작업의 흐름을 기록해요'
const strip = page => page.getByRole('navigation', { name: 'Tabs', exact: true })
const tabLinks = page => strip(page).getByRole('link')
const currentTab = page => strip(page).locator('a[aria-current="page"]')
const sidebar = page => page.getByRole('navigation', { name: 'Project documents', exact: true })
const sidebarBox = page => page.locator('aside').filter({ has: page.getByRole('combobox', { name: 'Switch project', exact: true }) })
const heading = (page, name) => page.getByRole('heading', { name, exact: true, level: 1 })
const mockTools = page => page.route('**/api/claude', route => route.fulfill({ json: {} }))
const openDocument = async (page, path = '/p/moa-design/overview', name = overview) => {
  await page.goto(path)
  await expect(heading(page, name)).toBeVisible()
}
// The page menu's Open in new tab: a right click on the page's row in the sidebar.
const openInNewTab = async (page, name) => {
  await sidebar(page).getByRole('link', { name, exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in new tab', exact: true }).click()
}
const top = locator => locator.evaluate(element => Math.round(element.getBoundingClientRect().top))
const scrollY = page => page.evaluate(() => Math.round(window.scrollY))
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)

test('a page opened in a new tab joins a strip of tabs at the top of the window, which one tab never shows', async ({ page, context }) => {
  await login(page)
  await mockTools(page)
  await openDocument(page)
  // One tab: no strip, and no room left for one.
  await expect(strip(page)).toHaveCount(0)
  expect(await top(sidebarBox(page))).toBe(0)
  await page.evaluate(() => window.scrollTo(0, 700))

  let opened = 0
  context.on('page', () => { opened += 1 })
  await openInNewTab(page, note)
  await expect(page).toHaveURL(/\/p\/moa-design\/note-2$/)
  await expect(heading(page, noteHeading)).toBeVisible()
  expect(opened).toBe(0)
  await expect(tabLinks(page)).toHaveText([overview, note])
  await expect(currentTab(page)).toHaveText(note)
  // The strip is fixed over the top of the window, the page starts under it and the sidebar sticks under it.
  const bar = await strip(page).boundingBox()
  expect(bar.y).toBe(0)
  expect(await top(sidebarBox(page))).toBe(Math.round(bar.height))
  await noOverflow(page)

  // A tab shows its page where the reader left it.
  await tabLinks(page).first().click()
  await expect(page).toHaveURL(/\/p\/moa-design\/overview$/)
  await expect(currentTab(page)).toHaveText(overview)
  await expect.poll(() => scrollY(page)).toBe(700)
  // The page's link names it, and a link with a modifier key is the browser's.
  await expect(tabLinks(page).nth(1)).toHaveAttribute('href', '/p/moa-design/note-2')

  // Back and Forward go through the pages in the tabs they were opened in.
  await page.goBack()
  await expect(page).toHaveURL(/\/p\/moa-design\/note-2$/)
  await expect(currentTab(page)).toHaveText(note)
  await page.goForward()
  await expect(page).toHaveURL(/\/p\/moa-design\/overview$/)
  await expect(currentTab(page)).toHaveText(overview)

  // A page followed in a tab is that tab's page now.
  await sidebar(page).getByRole('link', { name: '이번 주 작업 노트', exact: true }).click()
  await expect(page).toHaveURL(/\/p\/moa-design\/note-3$/)
  await expect(tabLinks(page)).toHaveText(['이번 주 작업 노트', note])
  await expect(currentTab(page)).toHaveText('이번 주 작업 노트')

  // A reload keeps the tabs.
  await page.reload()
  await expect(heading(page, noteHeading)).toBeVisible()
  await expect(tabLinks(page)).toHaveText(['이번 주 작업 노트', note])

  // Closing the tab on screen shows the one beside it in its place. With one tab left the strip goes, and its room.
  await strip(page).getByRole('button', { name: 'Close 이번 주 작업 노트', exact: true }).click()
  await expect(page).toHaveURL(/\/p\/moa-design\/note-2$/)
  await expect(strip(page)).toHaveCount(0)
  expect(await top(sidebarBox(page))).toBe(0)
  expect(opened).toBe(0)
})

test('tabs close from a middle click, Delete or their ×, move when dragged, and + opens the projects in a new tab', async ({ page, context }) => {
  await login(page)
  await mockTools(page)
  await openDocument(page)
  await openInNewTab(page, note)
  await expect(heading(page, noteHeading)).toBeVisible()
  // A tab opens beside the one it was opened from.
  await openInNewTab(page, '다음 단계')
  await expect(page).toHaveURL(/\/p\/moa-design\/note-4$/)
  await expect(tabLinks(page)).toHaveText([overview, note, '다음 단계'])

  // A middle click closes a tab, and opens nothing.
  let opened = 0
  context.on('page', () => { opened += 1 })
  await tabLinks(page).first().click({ button: 'middle' })
  await expect(tabLinks(page)).toHaveText([note, '다음 단계'])
  await expect(page).toHaveURL(/\/p\/moa-design\/note-4$/)
  expect(opened).toBe(0)

  // + opens the projects in a new tab.
  await strip(page).getByRole('button', { name: 'New tab', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: /Gather your thoughts/ })).toBeVisible()
  await expect(tabLinks(page)).toHaveText([note, '다음 단계', 'Projects'])
  await expect(currentTab(page)).toHaveText('Projects')
  const bar = await strip(page).boundingBox()
  expect(await top(page.locator('header').first())).toBe(Math.round(bar.height))

  // From the keyboard: the strip is one stop, on the tab on screen; the arrow keys go along it, Delete closes a tab.
  await currentTab(page).focus()
  await expect(currentTab(page)).toHaveAttribute('tabindex', '0')
  await expect(tabLinks(page).first()).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('ArrowLeft')
  await expect(tabLinks(page).nth(1)).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(tabLinks(page)).toHaveText([note, 'Projects'])
  await expect(currentTab(page)).toBeFocused()
  await expect(page).toHaveURL(/\/$/)

  // A tab dragged along the strip moves there.
  await tabLinks(page).nth(1).dragTo(tabLinks(page).first(), { targetPosition: { x: 8, y: 8 } })
  await expect(tabLinks(page)).toHaveText(['Projects', note])
  await expect(page).toHaveURL(/\/$/)

  // The × of another tab closes it; the strip goes with the second-last tab.
  await strip(page).getByRole('listitem').nth(1).hover()
  await strip(page).getByRole('button', { name: `Close ${note}`, exact: true }).click()
  await expect(strip(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
})

test('the search opens a page in a new tab with ⌘↵, and a new window starts with tabs of its own', async ({ page, context }) => {
  await login(page)
  await mockTools(page)
  await openDocument(page)
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Search documents', exact: true })
  await palette.getByRole('combobox', { name: 'Search documents', exact: true }).fill('다음 단계')
  await expect(palette.getByRole('option').first()).toContainText('다음 단계')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page).toHaveURL(/\/p\/moa-design\/note-4$/)
  await expect(tabLinks(page)).toHaveText([overview, '다음 단계'])

  // A window opened from the page menu has its own tabs: none but its page, so no strip.
  await sidebar(page).getByRole('link', { name: note, exact: true }).click({ button: 'right' })
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('menuitem', { name: 'Open in new window', exact: true }).click()])
  await expect(heading(popup, noteHeading)).toBeVisible()
  await expect(strip(popup)).toHaveCount(0)
  expect(await popup.evaluate(() => document.documentElement.hasAttribute('data-tabs'))).toBe(false)
  await popup.close()
  await expect(tabLinks(page)).toHaveText([overview, '다음 단계'])
})

test('the room for the strip is there before the page renders, and the strip fits a phone', async ({ page }) => {
  await login(page)
  await mockTools(page)
  await openDocument(page)
  await openInNewTab(page, '아주 긴 한글 제목과 표 그리고 URL의 반응형 읽기 검수')
  await expect(heading(page, '아주 긴 한글 제목도 좁은 화면에서 편안하게 읽을 수 있어야 합니다')).toBeVisible()

  // The strip passes the accessibility checks.
  const results = await new AxeBuilder({ page }).include('nav[aria-label="Tabs"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations.map(violation => violation.id)).toEqual([])

  // Without the app's scripts the page still leaves the strip its room: the script in the page's head did it.
  await page.route('**/_next/static/chunks/**', route => route.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-tabs'))).toBe(true)
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingTop)).toBe('40px')
  await page.unroute('**/_next/static/chunks/**')

  // On a phone, long titles end in an ellipsis inside their tabs and the page doesn't move sideways.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(heading(page, '아주 긴 한글 제목도 좁은 화면에서 편안하게 읽을 수 있어야 합니다')).toBeVisible()
  await expect(tabLinks(page)).toHaveCount(2)
  const tab = await strip(page).getByRole('listitem').nth(1).boundingBox()
  expect(tab.width).toBeLessThanOrEqual(11 * 16 + 1)
  expect(await tabLinks(page).nth(1).locator('span').evaluate(title => title.scrollWidth > title.clientWidth)).toBe(true)
  await noOverflow(page)
})
