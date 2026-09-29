import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import { login } from './review-session.mjs'
import { reviewRoot } from '../scripts/review-fixtures.mjs'

const deckFile = path.join(reviewRoot, 'projects/guide/slides.mdx')
const openDeck = async page => {
  await page.goto('/p/guide/slides')
  await expect(page.getByRole('group', { name: /^1 of 8/ })).toBeVisible()
}
const presenter = page => page.getByRole('dialog', { name: /^Presentation/ })
const onScreen = page => presenter(page).locator('[data-current-slide]')
const wcag = page => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()

test.beforeEach(async ({ page }) => { await login(page) })

test('덱은 슬라이드를 카드로 보여 주고 캔버스를 카드 크기에 맞춘다', async ({ page }) => {
  await openDeck(page)
  const cards = page.getByRole('group', { name: / of 8/ })
  await expect(cards).toHaveCount(8)
  // The canvas is a fixed page scaled to its frame: same width, same aspect ratio.
  const sizes = await cards.first().evaluate(card => {
    const frame = card.firstElementChild.getBoundingClientRect()
    const canvas = card.firstElementChild.firstElementChild.getBoundingClientRect()
    return { frame: [frame.width, frame.height], canvas: [canvas.width, canvas.height] }
  })
  expect(Math.abs(sizes.canvas[0] - sizes.frame[0])).toBeLessThanOrEqual(1)
  expect(Math.abs(sizes.frame[0] / sizes.frame[1] - 16 / 9)).toBeLessThan(0.01)
  // Speaker notes show under the card and hide with the toolbar toggle.
  const notes = page.getByText('Speaker notes go in')
  await expect(notes).toBeVisible()
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  await expect(notes).toBeHidden()
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  await expect(notes).toBeVisible()
  // A statement slide with no timer must not print a stray 0.
  await expect(cards.nth(7)).not.toContainText(/^0/)
})

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`덱 문서는 가로로 넘치지 않고 접근성 검사를 통과한다 (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openDeck(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
    const results = await wcag(page)
    expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([])
  })
}

test('발표 모드는 키보드로 넘기고 노트 · 목록 · 도움말을 열고 Esc 로 문서에 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openDeck(page)
  const present = page.getByRole('button', { name: 'Present', exact: true })
  await present.click()
  await expect(presenter(page)).toBeVisible()
  await expect(onScreen(page)).toHaveAttribute('aria-label', /^1 of 8/)
  await expect(page).toHaveURL(/#slide-1$/)
  // Full screen must not cover the slides: the layer, not the page, is what shows.
  await expect.poll(() => page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight / 3)?.closest('[aria-modal="true"]'))).toBe(true)

  await page.keyboard.press('ArrowRight')
  await expect(onScreen(page)).toHaveAttribute('aria-label', /^2 of 8/)
  await page.keyboard.press('Space')
  await expect(onScreen(page)).toHaveAttribute('aria-label', /^3 of 8/)
  await page.keyboard.press('ArrowLeft')
  await expect(onScreen(page)).toHaveAttribute('aria-label', /^2 of 8/)
  await page.keyboard.press('KeyN')
  await expect(presenter(page).getByRole('complementary', { name: 'Speaker notes' })).toContainText('Speaker notes go in')
  await page.keyboard.press('6')
  await page.keyboard.press('Enter')
  await expect(onScreen(page)).toHaveAttribute('aria-label', /^6 of 8/)
  const ticked = onScreen(page).locator('[role="checkbox"][aria-checked="true"]')
  await expect(ticked).toHaveCount(1)
  await page.keyboard.press('KeyC')
  await expect(ticked).toHaveCount(2)
  expect((await wcag(page)).violations.map(({ id }) => id)).toEqual([])

  await page.keyboard.press('KeyO')
  const overview = presenter(page).getByRole('region', { name: 'All slides' })
  await expect(overview).toBeVisible()
  await overview.getByRole('button', { name: /^7/ }).click()
  await expect(overview).toBeHidden()
  await expect(onScreen(page)).toHaveAttribute('aria-label', /^7 of 8/)

  await page.keyboard.press('Shift+Slash')
  await expect(presenter(page).getByRole('region', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(presenter(page).getByRole('region', { name: 'Keyboard shortcuts' })).toBeHidden()
  await expect(presenter(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(presenter(page)).toBeHidden()
  await expect(present).toBeFocused()
  await expect(page.getByRole('group', { name: /^7 of 8/ })).toBeInViewport()
})

test('발표 중에 문서를 저장해도 같은 장에 머물고 타이머가 이어진다', async ({ page }) => {
  const original = fs.readFileSync(deckFile, 'utf8')
  try {
    await openDeck(page)
    await page.getByRole('group', { name: /^5 of 8/ }).getByRole('button', { name: 'Present from slide 5' }).click()
    await expect(onScreen(page)).toHaveAttribute('aria-label', /^5 of 8/)
    const timer = onScreen(page).getByRole('timer')
    await expect(timer).toHaveText('02:00')
    await page.keyboard.press('KeyT')
    await expect(timer).not.toHaveText('02:00', { timeout: 3000 })

    fs.writeFileSync(deckFile, original.replace('title="Open and run"', 'title="Open and run — edited"'))
    await expect(onScreen(page)).toContainText('Open and run — edited', { timeout: 15000 })
    await expect(onScreen(page)).toHaveAttribute('aria-label', /^5 of 8/)
    await expect(timer).not.toHaveText('02:00')
    await page.keyboard.press('Shift+KeyT')
    await expect(timer).toHaveText('02:00')
    await page.keyboard.press('Escape')
    await expect(presenter(page)).toBeHidden()
  } finally {
    fs.writeFileSync(deckFile, original)
  }
})
