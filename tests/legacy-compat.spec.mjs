import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { reviewRoot } from '../scripts/review-fixtures.mjs'
import { login } from './review-session.mjs'

const slug = 'legacy-class-review'
const componentName = 'legacy-class-review-components.jsx'
const fixtureDirectory = path.join(reviewRoot, 'projects', 'moa-design')
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#efefeb"/></svg>')}`
const component = `import React from 'react'
export default function LegacyReport() {
  return <>
    <style>{'.page .legacy-custom { outline: 3px solid rgb(45, 80, 110); }'}</style>
    <p className="legacy-custom">An external report with its own page selector.</p>
    <div className="progress">
      <div className="progress-head"><span className="progress-label">Example progress</span><span className="progress-pct">62%</span></div>
      <div className="progress-track"><div className="progress-fill" style={{ width: '62%' }} /></div>
      <div className="progress-sub">Fictional progress for compatibility review.</div>
    </div>
    {['info', 'warn', 'success', 'danger'].map(tone => <div key={tone} className={'callout ' + tone}>
      <div className="callout-title">Example {tone}</div><div className="callout-body"><p>Fictional message.</p></div>
    </div>)}
    <div className="media-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {[1, 2, 3].map(number => <figure key={number}><img src={${JSON.stringify(image)}} alt={'Example still ' + number} /><figcaption>Fictional media example {number}</figcaption></figure>)}
    </div>
  </>
}
`
const document = `import LegacyReport from './${componentName}'
export const title = 'Legacy report compatibility'
export const group = 'Compatibility review'
export const order = 97

# Legacy report compatibility

This fictional report uses an external React component and the original public CSS classes.

<LegacyReport />
`

async function withLegacyDocument(run) {
  const created = []
  try {
    for (const [name, content] of [[componentName, component], [`${slug}.mdx`, document]]) {
      const file = path.join(fixtureDirectory, name)
      // Exclusive creation never replaces an existing fixture or user file.
      fs.writeFileSync(file, content, { flag: 'wx' })
      created.push(file)
    }
    await run()
  } finally {
    for (const file of created.reverse()) fs.unlinkSync(file)
  }
}

test('external JSX keeps legacy progress, callout tones, and page-scoped custom styles', async ({ page }) => {
  await withLegacyDocument(async () => {
    await login(page)
    await page.goto(`/p/moa-design/${slug}`)
    await expect(page.getByRole('heading', { name: 'Legacy report compatibility', exact: true })).toBeVisible()
    await expect(page.locator('.page .legacy-custom')).toHaveCSS('outline-width', '3px')
    await expect(page.locator('.legacy-custom')).toHaveCSS('outline-style', 'solid')
    const progress = await page.locator('.progress').evaluate(element => {
      const track = element.querySelector('.progress-track')
      const fill = element.querySelector('.progress-fill')
      return { track: track.getBoundingClientRect().height, fill: fill.getBoundingClientRect().height,
        ratio: fill.getBoundingClientRect().width / track.getBoundingClientRect().width,
        trackColor: getComputedStyle(track).backgroundColor, fillColor: getComputedStyle(fill).backgroundColor }
    })
    expect(progress.track).toBeGreaterThan(0)
    expect(progress.fill).toBe(progress.track)
    expect(progress.ratio).toBeCloseTo(0.62, 2)
    expect(progress.fillColor).not.toBe(progress.trackColor)
    const callouts = await page.locator('article .callout').evaluateAll(elements => elements.map(element => ({
      border: getComputedStyle(element).borderLeftColor,
      width: getComputedStyle(element).borderLeftWidth,
      title: getComputedStyle(element.querySelector('.callout-title')).color,
    })))
    expect(callouts).toHaveLength(4)
    expect(new Set(callouts.map(callout => callout.border)).size).toBe(4)
    expect(callouts.every(callout => callout.width === '3px' && callout.title === callout.border)).toBe(true)
  })
})

test('legacy media grid retains desktop columns and reflows without mobile overflow', async ({ page }) => {
  await withLegacyDocument(async () => {
    await login(page)
    await page.goto(`/p/moa-design/${slug}`)
    await expect(page.getByRole('heading', { name: 'Legacy report compatibility', exact: true })).toBeVisible()
    const grid = page.locator('article .media-grid')
    await expect(grid).toHaveCSS('display', 'grid')
    await expect.poll(() => grid.evaluate(element => [...element.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0))).toBe(true)
    for (const [width, columns] of [[1440, 3], [390, 2], [320, 1]]) {
      await page.setViewportSize({ width, height: 900 })
      const layout = await grid.evaluate(element => ({
        columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
        gridWidth: element.getBoundingClientRect().width,
        mediaWidths: [...element.querySelectorAll('img')].map(image => image.getBoundingClientRect().width),
        overflow: document.documentElement.scrollWidth - innerWidth,
      }))
      expect(layout.columns, `grid columns at ${width}px`).toBe(columns)
      expect(layout.mediaWidths.every(imageWidth => imageWidth > 0 && imageWidth <= layout.gridWidth)).toBe(true)
      expect(layout.overflow, `document overflow at ${width}px`).toBeLessThanOrEqual(1)
    }
  })
})
