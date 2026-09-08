import { test, expect } from '@playwright/test'
import { login } from './review-session.mjs'

const brokenBundle = 'module.exports.default = function BrokenReport() { throw new Error("회귀 검수용 런타임 오류") }'
const repairedBundle = 'const React = require("react"); module.exports.default = function RepairedReport() { return React.createElement("h1", null, "다시 읽을 수 있는 문서") }'
const openDocument = async page => {
  await page.goto('/p/moa-design/overview')
  await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible()
}

// Keep all Claude execution inside an in-browser stream; these tests never
// launch a CLI or submit a prompt to the real chat endpoint.
async function installChatStream(page) {
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    window.readerRuns = []
    window.readerStopRequests = []
    window.fetch = (input, options) => {
      if (input === '/api/chat') {
        const index = window.readerRuns.length
        const state = { aborted: false, request: JSON.parse(options.body) }
        window.readerRuns.push(state)
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            state.controller = controller
            const events = [
              { type: 'moa-run', runId: `reader-run-${index}` },
              { type: 'system', subtype: 'init', session_id: `reader-session-${index}` },
            ]
            controller.enqueue(new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
            options.signal.addEventListener('abort', () => {
              state.aborted = true
              controller.error(new DOMException('Aborted', 'AbortError'))
            })
          },
        }), { headers: { 'content-type': 'application/x-ndjson' } }))
      }
      if (input === '/api/chat/stop') {
        window.readerStopRequests.push(JSON.parse(options.body))
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }))
      }
      return originalFetch(input, options)
    }
  })
}

for (const width of [390, 1440]) {
  test(`${width}px AI 패널 닫기 후에도 실행·응답·초안이 유지되고 명시적 중지만 실행을 취소함`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await login(page)
    await openDocument(page)
    await installChatStream(page)
    const open = () => page.getByRole('button', { name: 'Open AI assistant', exact: true }).click()
    const close = () => width < 1280
      ? page.getByRole('dialog', { name: 'AI assistant', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
      : page.locator('section[aria-label="Project AI conversation"]').getByRole('button', { name: 'Close AI assistant', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Message to AI' })

    await open()
    await page.getByRole('checkbox', { name: 'Auto-approve tools' }).check()
    await input.fill('패널을 닫아도 계속할 검수 작업')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.readerRuns.length)).toBe(1)
    await input.fill('다시 열었을 때 남아 있어야 하는 초안')
    await close()
    await expect(input).not.toBeVisible()
    expect(await page.evaluate(() => window.readerRuns[0].aborted)).toBe(false)

    await page.evaluate(() => {
      window.readerRuns[0].controller.enqueue(new TextEncoder().encode(JSON.stringify({
        type: 'assistant', message: { content: [{ type: 'text', text: '패널이 닫힌 동안에도 도착한 응답' }] },
      }) + '\n'))
    })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hub.chat.moa-design')).items.some(item => item.text === '패널이 닫힌 동안에도 도착한 응답'))).toBe(true)
    await open()
    await expect(page.getByText('패널이 닫힌 동안에도 도착한 응답', { exact: true })).toBeVisible()
    await expect(input).toHaveValue('다시 열었을 때 남아 있어야 하는 초안')
    await expect(page.getByRole('checkbox', { name: /Auto-approve tools/ })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()

    await close()
    await page.evaluate(() => {
      const run = window.readerRuns[0]
      run.controller.enqueue(new TextEncoder().encode(JSON.stringify({
        type: 'result', subtype: 'success', session_id: 'reader-session-0', duration_ms: 250,
      }) + '\n'))
      run.controller.close()
    })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hub.chat.moa-design')).items.some(item => item.kind === 'result'))).toBe(true)
    await open()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()

    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.readerRuns.length)).toBe(2)
    expect(await page.evaluate(() => window.readerRuns[1].request)).toMatchObject({
      prompt: '다시 열었을 때 남아 있어야 하는 초안', dangerous: true, sessionId: 'reader-session-0',
    })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.readerRuns[1].aborted)).toBe(true)
    await expect.poll(() => page.evaluate(() => window.readerStopRequests)).toEqual([{ runId: 'reader-run-1' }])
  })
}

test('런타임 오류의 다시 시도는 수정된 문서 번들을 실제로 다시 렌더함', async ({ page }) => {
  await login(page)
  let repaired = false
  let releaseRepair
  const repairResponse = new Promise(resolve => { releaseRepair = resolve })
  await page.route('**/api/doc?*', async route => {
    if (new URL(route.request().url()).searchParams.get('doc') !== 'runtime-error') return route.continue()
    if (repaired) await repairResponse
    return route.fulfill({ json: { code: repaired ? repairedBundle : brokenBundle } })
  })
  try {
    await page.goto('/p/guide/runtime-error')
    await expect(page.getByText('Could not load this document.', { exact: true })).toBeVisible()
    repaired = true
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.getByRole('status', { name: 'Loading document' })).toBeVisible()
    releaseRepair()
    await expect(page.getByRole('heading', { name: '다시 읽을 수 있는 문서', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
  } finally { releaseRepair() }
})

test('런타임 오류 뒤 SSE로 새 번들이 오면 오류 경계도 복구됨', async ({ page }) => {
  await login(page)
  // Drive the existing useWatch callback without changing any fixture files.
  await page.addInitScript(() => {
    window.readerWatchers = []
    window.EventSource = class {
      constructor(url) { this.url = url; this.closed = false; window.readerWatchers.push(this) }
      close() { this.closed = true }
    }
  })
  let repaired = false
  await page.route('**/api/doc?*', route => {
    if (new URL(route.request().url()).searchParams.get('doc') !== 'runtime-error') return route.continue()
    return route.fulfill({ json: { code: repaired ? repairedBundle : brokenBundle } })
  })
  await page.goto('/p/guide/runtime-error')
  await expect(page.getByText('Could not load this document.', { exact: true })).toBeVisible()
  repaired = true
  await page.evaluate(() => {
    for (const watcher of window.readerWatchers) {
      if (!watcher.closed && watcher.url === '/api/watch?slug=guide') watcher.onmessage?.({ data: 'refresh' })
    }
  })
  await expect(page.getByRole('heading', { name: '다시 읽을 수 있는 문서', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
})
