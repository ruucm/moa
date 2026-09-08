import { test, expect } from '@playwright/test'
import { login } from './review-session.mjs'

// UI labels are English; report/project titles intentionally use the existing
// Korean review fixtures. Every Claude, history and terminal action is mocked.
const openDocument = async page => {
  await page.goto('/p/moa-design/overview')
  await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible()
}
const mockTools = (page, tools = { skills: [], agents: [] }) => page.route('**/api/claude', route => route.fulfill({ json: { 'moa-design': tools } }))
const completedStream = (sessionId, text, extra = []) => [
  { type: 'moa-run', runId: 'mock-reader-action' },
  { type: 'system', subtype: 'init', session_id: sessionId },
  ...extra,
  { type: 'assistant', message: { content: [{ type: 'text', text }] } },
  { type: 'result', subtype: 'success', session_id: sessionId, duration_ms: 25 },
].map(event => JSON.stringify(event)).join('\n')

test('history errors recover, selected sessions resume, and a new session clears the resume ID', async ({ page }) => {
  await login(page)
  await mockTools(page)
  await page.addInitScript(() => localStorage.setItem('hub.chat.moa-design', JSON.stringify({
    sessionId: 'mock-original-session', items: [{ kind: 'text', text: 'Original conversation stays intact' }],
  })))
  let listRequests = 0
  let sessionRequests = 0
  const chatRequests = []
  await page.route('**/api/sessions?*', route => {
    expect(new URL(route.request().url()).searchParams.get('slug')).toBe('moa-design')
    listRequests += 1
    return route.fulfill(listRequests === 1
      ? { status: 503, json: { error: 'Mock history service unavailable' } }
      : { json: { sessions: [{ id: 'mock-selected-session', title: 'Saved review conversation', mtime: Date.now(), size: 2048 }] } })
  })
  await page.route('**/api/session?*', route => {
    const query = new URL(route.request().url()).searchParams
    expect(query.get('slug')).toBe('moa-design')
    expect(query.get('id')).toBe('mock-selected-session')
    sessionRequests += 1
    return route.fulfill(sessionRequests === 1
      ? { status: 503, json: { error: 'Mock conversation could not be read' } }
      : { json: { id: 'mock-selected-session', skipped: 3, items: [{ kind: 'text', text: 'Restored review conversation' }] } })
  })
  await page.route('**/api/chat', route => {
    const payload = route.request().postDataJSON()
    chatRequests.push(payload)
    return route.fulfill({ contentType: 'application/x-ndjson', body: completedStream(payload.sessionId || 'mock-fresh-session', `Mock reply ${chatRequests.length}`) })
  })
  await openDocument(page)
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click()
  const history = page.getByRole('button', { name: 'History', exact: true })
  const input = page.getByRole('textbox', { name: 'Message to AI', exact: true })
  await expect(page.getByText('Original conversation stays intact', { exact: true })).toBeVisible()

  await history.click()
  await expect(page.getByRole('region', { name: 'Project AI conversation' }).getByRole('alert')).toHaveText('Mock history service unavailable')
  await history.click()
  await expect(page.getByText('Original conversation stays intact', { exact: true })).toBeVisible()
  await history.click()
  await page.getByRole('button', { name: /Saved review conversation/ }).click()
  await expect(page.getByRole('region', { name: 'Project AI conversation' }).getByRole('alert')).toHaveText('Mock conversation could not be read')
  await expect(history).toBeFocused()
  await expect(page.getByRole('button', { name: /Saved review conversation/ })).toBeEnabled()
  await history.click()
  await expect(page.getByText('Original conversation stays intact', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hub.chat.moa-design')).sessionId)).toBe('mock-original-session')

  await history.click()
  await page.getByRole('button', { name: /Saved review conversation/ }).click()
  await expect(page.getByText('Restored review conversation', { exact: true })).toBeVisible()
  await expect(page.getByText('Showing recent messages; 3 earlier items omitted.', { exact: true })).toBeVisible()
  await expect(input).toBeFocused()
  await expect(page.getByText('Original conversation stays intact', { exact: true })).toHaveCount(0)
  await input.fill('Continue the selected conversation')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Mock reply 1', { exact: true })).toBeVisible()
  expect(chatRequests[0]).toMatchObject({ slug: 'moa-design', sessionId: 'mock-selected-session', dangerous: false })

  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await expect(input).toBeFocused()
  await expect(page.getByText('Restored review conversation', { exact: true })).toHaveCount(0)
  await input.fill('Start a fresh conversation')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Mock reply 2', { exact: true })).toBeVisible()
  expect(chatRequests[1]).toMatchObject({ sessionId: null, prompt: 'Start a fresh conversation' })
})

test('skill and agent actions retain their prompts and terminal actions use the trigger API only', async ({ page }) => {
  await login(page)
  await mockTools(page, {
    skills: [{ name: 'review-notes', description: 'Fictional skill for UI verification' }],
    agents: [{ name: 'outline-reviewer', description: 'Fictional agent for UI verification' }],
  })
  const chatRequests = []
  const terminalRequests = []
  await page.route('**/api/chat', route => {
    chatRequests.push(route.request().postDataJSON())
    const number = chatRequests.length
    return route.fulfill({ contentType: 'application/x-ndjson', body: completedStream('mock-tools-session', `Mock tool run ${number} complete`, [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: `mock-tool-${number}`, name: 'Read', input: { file_path: '/mock/report.mdx' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `mock-tool-${number}`, content: `Mock file output ${number}`, is_error: false }] } },
    ]) })
  })
  await page.route('**/api/trigger', route => {
    terminalRequests.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await openDocument(page)
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click()
  await page.locator('summary').filter({ hasText: 'Project tools' }).click()
  await page.getByRole('button', { name: /^review-notes\s*Skill$/ }).click()
  await expect(page.getByText('Mock tool run 1 complete', { exact: true })).toBeVisible()
  expect(chatRequests[0]).toMatchObject({ slug: 'moa-design', prompt: '/review-notes', dangerous: false })
  await page.locator('summary').filter({ hasText: 'Read' }).first().click()
  await expect(page.getByLabel('Read output').first()).toHaveText('Mock file output 1')
  await page.getByRole('button', { name: /^outline-reviewer\s*Agent$/ }).click()
  await expect(page.getByText('Mock tool run 2 complete', { exact: true })).toBeVisible()
  expect(chatRequests[1]).toMatchObject({ prompt: 'Use the outline-reviewer subagent.', sessionId: 'mock-tools-session' })

  await page.getByRole('button', { name: 'review-notes open in Terminal', exact: true }).click()
  await expect.poll(() => terminalRequests.length).toBe(1)
  await page.getByRole('button', { name: 'outline-reviewer open in Terminal', exact: true }).click()
  await expect.poll(() => terminalRequests.length).toBe(2)
  expect(terminalRequests).toEqual([
    { slug: 'moa-design', kind: 'skill', name: 'review-notes' },
    { slug: 'moa-design', kind: 'agent', name: 'outline-reviewer' },
  ])
  expect(chatRequests).toHaveLength(2)
})

test('document groups preserve their collapsed state per project across reloads and project switches', async ({ page }) => {
  await login(page)
  await mockTools(page)
  await openDocument(page)
  const navigation = page.getByRole('navigation', { name: 'Project documents', exact: true })
  const group = navigation.getByRole('button', { name: /작업 기록/ })
  const note = navigation.getByRole('link', { name: '관찰과 배움', exact: true })
  await expect(note).toBeVisible()
  await group.click()
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await expect(note).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hub.collapsed.moa-design')))).toContain('작업 기록')
  await page.reload()
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await expect(note).toHaveCount(0)

  await page.getByRole('combobox', { name: 'Switch project', exact: true }).selectOption('brand-notes')
  await expect(page).toHaveURL(/\/p\/brand-notes$/)
  await expect(page.getByRole('combobox', { name: 'Switch project', exact: true })).toHaveValue('brand-notes')
  await expect(group).toHaveAttribute('aria-expanded', 'true')
  await expect(note).toBeVisible()
  await page.getByRole('combobox', { name: 'Switch project', exact: true }).selectOption('moa-design')
  await expect(page).toHaveURL(/\/p\/moa-design$/)
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await group.click()
  await note.click()
  await expect(page).toHaveURL(/\/p\/moa-design\/note-2$/)
  await expect(page.getByRole('heading', { name: '작업의 흐름을 기록해요', exact: true })).toBeVisible()
  await expect(note).toHaveAttribute('aria-current', 'page')
})

for (const width of [390, 1440]) {
  test(`${width}px active document search remains clearable when SSE reduces the list below six documents`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    await mockTools(page)
    const response = await page.request.get('/api/projects')
    expect(response.ok()).toBeTruthy()
    const index = await response.json()
    const project = index.projects.find(entry => entry.slug === 'moa-design')
    // The extra index entry is fictional and is never opened as a document.
    const documents = [...project.docs, { slug: 'mock-transient-note', title: 'Mock transient note', group: '검수', order: 99 }]
    expect(documents).toHaveLength(6)
    let remaining = 6
    await page.route('**/api/projects', route => route.fulfill({ json: {
      ...index, projects: index.projects.map(entry => entry.slug === 'moa-design' ? { ...entry, docs: documents.slice(0, remaining) } : entry),
    } }))
    await page.addInitScript(() => {
      window.readerActionWatchers = []
      window.EventSource = class {
        constructor(url) { this.url = url; this.closed = false; window.readerActionWatchers.push(this) }
        close() { this.closed = true }
      }
    })
    await openDocument(page)
    if (width < 768) await page.getByRole('button', { name: 'Open document navigation', exact: true }).click()
    const surface = width < 768 ? page.getByRole('dialog', { name: 'Document navigation', exact: true })
      : page.locator('aside').filter({ has: page.getByRole('combobox', { name: 'Switch project', exact: true }) })
    const search = surface.getByRole('textbox', { name: 'Search documents', exact: true })
    const navigation = surface.getByRole('navigation', { name: 'Project documents', exact: true })
    await search.fill('관찰')
    await expect(navigation.getByRole('link')).toHaveCount(1)
    await expect(navigation.getByRole('link', { name: '관찰과 배움', exact: true })).toBeVisible()
    remaining = 5
    await page.evaluate(() => {
      for (const watcher of window.readerActionWatchers) {
        if (!watcher.closed && watcher.url === '/api/watch?slug=moa-design') watcher.onmessage?.({ data: 'refresh' })
      }
    })
    await expect(surface.getByText('5 documents', { exact: true })).toBeVisible()
    await expect(search).toBeVisible()
    await expect(search).toHaveValue('관찰')
    await expect(navigation.getByRole('link')).toHaveCount(1)
    await surface.getByRole('button', { name: 'Clear document search', exact: true }).click()
    await expect(search).toHaveCount(0)
    await expect(navigation.getByRole('link')).toHaveCount(5)
  })
}
