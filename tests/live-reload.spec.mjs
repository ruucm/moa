import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { login } from './review-session.mjs'
import { reviewRoot } from '../scripts/review-fixtures.mjs'

// Live reload must not spend the browser's connections. A browser opens at most six connections to one
// plain-HTTP/1.1 host; when every visible tab held its own /api/watch stream, six MOA windows took all six
// and the seventh never loaded. The tabs now share one stream through a SharedWorker (lib/watch-worker.js).
const heading = '더 명확하게, 더 편안하게'
const mockTools = context => context.route('**/api/claude', route => route.fulfill({ json: {} }))
// "Save" a fixture without changing a byte — a new mtime is all the watcher looks at.
const touch = (...parts) => { const now = new Date(); fs.utimesSync(path.join(reviewRoot, ...parts), now, now) }
const requestsTo = (page, part) => {
  const seen = []
  page.on('request', request => { if (request.url().includes(part)) seen.push(request.url()) })
  return seen
}
const openDocument = async (page, slug = 'moa-design') => {
  await page.goto(`/p/${slug}/overview`)
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
}

test('eight visible tabs all load, and a save reaches only the tabs reading that project', async ({ context }) => {
  test.setTimeout(120000)
  await mockTools(context)
  const tabs = []
  for (const slug of ['moa-design', 'moa-design', 'moa-design', 'brand-notes', 'brand-notes', 'product-research', null, 'moa-design']) {
    const page = await context.newPage()
    if (!tabs.length) await login(page)
    const tab = { slug, page, docs: requestsTo(page, '/api/doc?'), lists: requestsTo(page, '/api/projects') }
    if (slug) await openDocument(page, slug)
    else {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible()
    }
    tabs.push(tab)
  }
  // Every tab is visible at once here (a headless browser hides none), which is what used to take all six connections.
  expect(await Promise.all(tabs.map(tab => tab.page.evaluate(() => document.hidden)))).toEqual(tabs.map(() => false))

  // Save until the first tab hears it — from then on the shared stream is known to be live.
  const first = tabs[0].docs.length
  await expect.poll(() => { touch('projects', 'moa-design', 'overview.mdx'); return tabs[0].docs.length }).toBeGreaterThan(first)
  await tabs[0].page.waitForTimeout(1500)

  let before = tabs.map(tab => tab.docs.length)
  touch('projects', 'moa-design', 'overview.mdx')
  await expect.poll(() => tabs.filter(tab => tab.slug === 'moa-design').every((tab) => tab.docs.length > before[tabs.indexOf(tab)])).toBe(true)
  await tabs[0].page.waitForTimeout(1000)
  tabs.forEach((tab, index) => expect(tab.docs.length - before[index], `tab ${index} · ${tab.slug || 'hub'}`).toBe(tab.slug === 'moa-design' ? 1 : 0))

  // The hub tab listens to the project list, not to documents.
  const hub = tabs.find(tab => !tab.slug)
  before = tabs.map(tab => tab.docs.length)
  const listed = hub.lists.length
  touch('registry.json')
  await expect.poll(() => hub.lists.length).toBe(listed + 1)
  await hub.page.waitForTimeout(1000)
  expect(tabs.map(tab => tab.docs.length)).toEqual(before)
})

test('a hidden tab stops listening, and catches up once when it is shown again', async ({ page, context }) => {
  await mockTools(context)
  await login(page)
  await page.addInitScript(() => {
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    window.showTab = (visible) => { hidden = !visible; document.dispatchEvent(new Event('visibilitychange')) }
  })
  const docs = requestsTo(page, '/api/doc?')
  await openDocument(page)
  await page.waitForTimeout(1000)
  let count = docs.length

  await page.evaluate(() => window.showTab(false))
  touch('projects', 'moa-design', 'overview.mdx')
  await page.waitForTimeout(1500)
  expect(docs.length).toBe(count)
  await page.evaluate(() => window.showTab(true))
  await expect.poll(() => docs.length).toBe(count + 1)

  // Hidden long enough for the worker to let the stream go: showing the tab reopens it, then catches up.
  count = docs.length
  await page.evaluate(() => window.showTab(false))
  await page.waitForTimeout(6500)
  await page.evaluate(() => window.showTab(true))
  await expect.poll(() => docs.length).toBe(count + 1)
  touch('projects', 'moa-design', 'overview.mdx')
  await expect.poll(() => docs.length).toBe(count + 2)
})

test('the shared stream names what changed, and a member only hears about invited projects', async ({ page }) => {
  await login(page, 'member@moa.example')
  await openDocument(page)
  await page.evaluate(async () => {
    window.heard = ''
    const response = await fetch('/api/watch?all=1')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    ;(async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        window.heard += decoder.decode(value)
      }
    })()
  })
  const heard = () => page.evaluate(() => window.heard)
  touch('projects', 'product-research', 'overview.mdx') // the member is not invited to this one
  touch('projects', 'moa-design', 'overview.mdx')
  await expect.poll(heard).toContain('data: {"topic":"moa-design"}')
  touch('registry.json')
  await expect.poll(heard).toContain('data: {"topic":""}')
  expect(await heard()).not.toContain('product-research')
})

test('a browser without SharedWorker falls back to one stream per visible tab', async ({ page, context }) => {
  await mockTools(context)
  await login(page)
  await page.addInitScript(() => { delete window.SharedWorker })
  const docs = requestsTo(page, '/api/doc?')
  const stream = page.waitForResponse(response => response.url().endsWith('/api/watch?slug=moa-design'))
  await openDocument(page)
  expect((await stream).status()).toBe(200)
  await page.waitForTimeout(1000)
  const count = docs.length
  touch('projects', 'moa-design', 'overview.mdx')
  await expect.poll(() => docs.length).toBe(count + 1)
})

test('a tab whose worker script fails to load falls back to its own stream too', async ({ page, context }) => {
  await mockTools(context)
  await login(page)
  await page.addInitScript(() => {
    const Real = window.SharedWorker
    window.SharedWorker = function (url, options) { return new Real('/api/watch/no-such-worker', options) }
  })
  const docs = requestsTo(page, '/api/doc?')
  const stream = page.waitForResponse(response => response.url().endsWith('/api/watch?slug=moa-design'))
  await openDocument(page)
  expect((await stream).status()).toBe(200)
  await page.waitForTimeout(1000)
  const count = docs.length
  touch('projects', 'moa-design', 'overview.mdx')
  await expect.poll(() => docs.length).toBe(count + 1)
})
