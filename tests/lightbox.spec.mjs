import { test, expect } from '@playwright/test'
import { login } from './review-session.mjs'

const openDocument = async page => {
  await page.goto('/p/moa-design/overview')
  await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible()
}
const viewer = page => page.getByRole('dialog')

test.beforeEach(async ({ page }) => { await login(page) })

test('문서의 이미지는 <Figure>든 마크다운이든 눌러서 원본으로 열린다', async ({ page }) => {
  await openDocument(page)
  const images = page.locator('.moa-prose img[data-zoomable]')
  await expect(images).toHaveCount(2)

  const figureImage = images.first()
  await figureImage.scrollIntoViewIfNeeded()
  await figureImage.click()
  await expect(viewer(page)).toBeVisible()
  await expect(viewer(page).locator('img')).toHaveAttribute('src', await figureImage.getAttribute('src'))
  await expect(viewer(page)).toContainText('1 / 2')

  await page.keyboard.press('Escape')
  await expect(viewer(page)).toBeHidden()
})

test('뷰어는 문서의 모든 이미지를 한 갤러리로 묶고 본 이미지로 돌려보낸다', async ({ page }) => {
  await openDocument(page)
  const images = page.locator('.moa-prose img[data-zoomable]')
  const [first, second] = [images.first(), images.nth(1)]
  const secondSource = await second.getAttribute('src')

  await first.scrollIntoViewIfNeeded()
  await first.click()
  await page.keyboard.press('ArrowRight')
  await expect(viewer(page)).toContainText('2 / 2')
  await expect(viewer(page).locator('img')).toHaveAttribute('src', secondSource)
  await expect(viewer(page).locator('img')).toHaveAttribute('alt', '문서 이미지 예시 2 — 마크다운 이미지')

  // 닫으면 처음 누른 이미지가 아니라 마지막으로 본 이미지로 초점이 돌아온다.
  await viewer(page).getByRole('button', { name: 'Close image viewer' }).click()
  await expect(viewer(page)).toBeHidden()
  await expect(second).toBeFocused()
})

test('이미지는 키보드로도 열 수 있고 문서는 가로로 넘치지 않는다', async ({ page }) => {
  await openDocument(page)
  const figureImage = page.locator('.moa-prose img[data-zoomable]').first()
  await figureImage.focus()
  await page.keyboard.press('Enter')
  await expect(viewer(page)).toBeVisible()
  await viewer(page).getByRole('button', { name: 'Next image' }).click()
  await expect(viewer(page)).toContainText('2 / 2')
  await page.keyboard.press('Escape')
  await expect(viewer(page)).toBeHidden()

  // wide 피겨는 읽기 단보다 넓지만 레이아웃 밖으로 나가지 않는다.
  const widths = await page.evaluate(() => {
    const figure = document.querySelector('.moa-prose figure')
    return {
      figure: figure.getBoundingClientRect().width,
      column: document.querySelector('.moa-prose').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
  expect(widths.figure).toBeGreaterThan(widths.column)
  expect(widths.overflow).toBeLessThanOrEqual(1)
})
