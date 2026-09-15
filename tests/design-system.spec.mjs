import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { login } from './review-session.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { reviewRoot, reviewPassword } from '../scripts/review-fixtures.mjs'

const screenshots = path.resolve('artifacts/screenshots')
fs.mkdirSync(screenshots, { recursive: true })
const home = async page => { await page.goto('/'); await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼', exact: true })).toBeVisible() }
const document = async page => { await page.goto('/p/moa-design/overview'); await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible() }
const capture = async (page, name, fullPage = false) => {
  await page.evaluate(() => globalThis.document.fonts.ready)
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage, animations: 'disabled' })
}
const noOverflow = async page => expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)

test('팀/오너 로그인과 문서로의 복귀', async ({ page }) => {
  await page.goto('/login?next=%2Fp%2Fmoa-design%2Foverview')
  await expect(page.getByRole('radio', { name: 'Team account' })).toBeChecked()
  await page.getByLabel('Email', { exact: true }).fill('review@moa.example')
  await page.getByLabel('Password', { exact: true }).fill(reviewPassword)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게', exact: true })).toBeVisible()
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByRole('radio', { name: 'Owner password' }).check()
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0)
  await page.locator('input[type="password"]').fill(reviewPassword)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Gather your thoughts./ })).toBeVisible()
})

test('허브 검색, 필터, 전체 목록 순서 저장, 실패 롤백', async ({ page }) => {
  await login(page); await home(page)
  const original = (await (await page.request.get('/api/projects')).json()).projects.filter(p => p.slug !== 'empty-project').map(p => p.slug)
  try {
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('브랜드')
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(1)
  await page.getByRole('button', { name: '브랜드의 다음 장 project menu' }).click()
  await expect(page.getByRole('button', { name: 'Move earlier' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('')
  await page.getByRole('combobox', { name: 'Project status' }).selectOption('done')
  await expect(page.getByRole('heading', { name: '우리 팀의 플레이북', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Project status' }).selectOption('all')
  await page.getByRole('button', { name: '브랜드의 다음 장 project menu' }).click()
  const saved = page.waitForResponse(r => r.url().endsWith('/api/order') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Move earlier' }).click()
  expect((await saved).ok()).toBeTruthy()
  await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('브랜드의 다음 장')
  await page.request.post('/api/order', { data: { slugs: original } })
  await home(page)
  await page.route('**/api/order', route => route.fulfill({ status: 500, json: { error: '검수용 저장 실패' } }))
  await page.getByRole('button', { name: '브랜드의 다음 장 project menu' }).click()
  await page.getByRole('button', { name: 'Move earlier' }).click()
  await expect(page.getByText('검수용 저장 실패')).toBeVisible()
  await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('모아 디자인 리뉴얼')
  } finally { await page.unroute('**/api/order'); await page.request.post('/api/order', { data: { slugs: original } }) }
})

test('설정 탭, 모달 포커스 복귀, project menu 확인창', async ({ page }) => {
  await login(page); await home(page)
  const workspaceMenu = page.getByRole('button', { name: 'Workspace menu' })
  await workspaceMenu.click()
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  await settings.click()
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Team members', exact: true }).click()
  await expect(page.getByText('review@moa.example', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Team members', exact: true }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Shared links' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Shared documents' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(workspaceMenu).toBeFocused()
  const menu = page.getByRole('button', { name: '모아 디자인 리뉴얼 project menu' })
  await menu.click()
  await page.getByRole('button', { name: 'Unregister', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(menu).toBeFocused()
})

test('문서 목차, 한글 중복 제목, 초기 앵커, SSE 갱신', async ({ page }) => {
  await login(page); await document(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  const outline = page.getByRole('complementary', { name: 'Document outline' })
  await expect(outline).toBeVisible()
  await outline.getByRole('link', { name: '다음으로 이어갈 일' }).click()
  await expect(page).toHaveURL(/#.+/)
  const file = path.join(reviewRoot, 'projects/moa-design/overview.mdx')
  const before = fs.readFileSync(file, 'utf8')
  try {
    fs.appendFileSync(file, '\n\n## 검수 중 추가한 문단\n\n실시간 갱신 예시입니다.\n')
    await expect(page.getByRole('heading', { name: '검수 중 추가한 문단' })).toBeAttached()
    await expect(outline.getByRole('link', { name: '검수 중 추가한 문단' })).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
  } finally { fs.writeFileSync(file, before) }
  await page.goto('/p/moa-design/long-content')
  await expect(page.getByRole('heading', { name: '같은 제목', exact: true })).toHaveCount(2)
  await expect.poll(async () => page.getByRole('heading', { name: '같은 제목', exact: true }).evaluateAll(headings => headings.map(h => h.id))).toEqual(['같은-제목', '같은-제목-2'])
  await page.goto('/p/moa-design/long-content#' + encodeURIComponent('같은-제목-2'))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
})

for (const width of [320, 390, 768, 1280, 1440]) {
  test(`${width}px 허브·긴 문서 가로 넘침과 모바일 탐색`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
    await login(page); await home(page); await noOverflow(page)
    await page.goto('/p/moa-design/long-content')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await noOverflow(page)
    if (width < 768) {
      const menu = page.getByRole('button', { name: 'Open document navigation' })
      await menu.click(); await expect(page.getByRole('dialog', { name: 'Document navigation' })).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('navigation', { name: 'Project documents' })).toBeVisible()
      await noOverflow(page); await page.keyboard.press('Escape'); await expect(menu).toBeFocused()
    }
  })
}

test('공유 게스트·멤버의 UI 및 API 접근 범위', async ({ page, browser }) => {
  await page.goto('/s/review-document-link-only')
  await expect(page.getByRole('heading', { name: '더 명확하게, 더 편안하게' })).toBeVisible()
  await expect(page.getByText('Shared document', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /AI assistant|Share link|Document navigation/ })).toHaveCount(0)
  expect((await page.request.get('/api/doc?slug=brand-notes&doc=overview')).status()).toBe(403)
  expect((await page.request.get('/api/users')).status()).toBe(401)
  const member = await browser.newContext({ baseURL: 'http://localhost:5001' })
  const memberPage = await member.newPage()
  await login(memberPage, 'member@moa.example'); await home(memberPage)
  await expect(memberPage.getByRole('heading', { level: 3 })).toHaveCount(2)
  await expect(memberPage.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0)
  expect((await memberPage.request.get('/api/users')).status()).toBe(403)
  await document(memberPage)
  await expect(memberPage.getByRole('button', { name: /AI assistant|Share link/ })).toHaveCount(0)
  await member.close()
})

test('런타임·컴파일 오류가 문서 하나에 격리됨', async ({ page }) => {
  await login(page)
  for (const name of ['runtime-error', 'compile-error']) {
    await page.goto(`/p/guide/${name}`)
    await expect(page.getByText('Could not load this document.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await document(page)
    await expect(page.getByRole('heading', { name: '이번 주의 한눈에 보기' })).toBeVisible()
  }
})

test('AI 응답·세션 복원·반응형 초안 유지 (모의 스트림)', async ({ page }) => {
  await login(page)
  const requests = []
  await page.route('**/api/chat', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'moa-run', runId: 'fixture-run' },
      { type: 'system', subtype: 'init', session_id: 'fixture-session' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '예시 응답: 문서의 위계와 모바일 탐색을 정리했어요.' }] } },
      { type: 'result', subtype: 'success', session_id: 'fixture-session', duration_ms: 100 },
    ].map(value => JSON.stringify(value)).join('\n') })
  })
  await document(page)
  await page.getByRole('button', { name: 'Open AI assistant' }).click()
  const input = page.getByRole('textbox', { name: 'Message to AI' })
  await input.fill('검수용 예시 요청')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('예시 응답: 문서의 위계와 모바일 탐색을 정리했어요.', { exact: true })).toBeVisible()
  expect(requests[0]).toMatchObject({ prompt: '검수용 예시 요청', dangerous: false })
  await input.fill('화면 크기가 바뀌어도 유지되는 초안')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('dialog', { name: 'AI assistant' })).toBeVisible()
  await expect(input).toHaveValue('화면 크기가 바뀌어도 유지되는 초안'); await noOverflow(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(input).toHaveValue('화면 크기가 바뀌어도 유지되는 초안')
  await page.reload()
  await page.getByRole('button', { name: 'Open AI assistant' }).click()
  await expect(page.getByText('예시 응답: 문서의 위계와 모바일 탐색을 정리했어요.', { exact: true })).toBeVisible()
  await input.fill('이어지는 예시 요청')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1].sessionId).toBe('fixture-session')
})

test('실제 UI·리포트 카탈로그와 이미지·영상 로딩', async ({ page }) => {
  await login(page); await page.goto('/p/guide/design-system')
  await expect(page.getByRole('heading', { name: 'MOA design system', exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar').first()).toBeAttached()
  for (const image of await page.locator('article img').all()) await image.scrollIntoViewIfNeeded()
  await expect.poll(() => page.locator('article img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
  await page.locator('article video').scrollIntoViewIfNeeded()
  await expect.poll(() => page.locator('article video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(1)
})

test('로그인·허브·문서·카탈로그·설정 접근성 자동 검사', async ({ page }) => {
  for (const route of ['/login', '/', '/p/moa-design/overview', '/p/guide/design-system']) {
    if (route !== '/login') await login(page)
    await page.goto(route)
    if (route === '/') await expect(page.getByRole('heading', { name: '모아 디자인 리뉴얼' })).toBeVisible()
    else if (route.startsWith('/p/')) await expect(page.locator('article h1')).toBeVisible()
    await page.evaluate(() => globalThis.document.fonts.ready)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), route).toEqual([])
  }
  await home(page); await page.getByRole('button', { name: 'Workspace menu' }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)) })
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await document(page)
  await page.getByRole('button', { name: 'Open AI assistant' }).click()
  await page.getByRole('dialog').evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)) })
  const mobile = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(mobile.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([])
})

test('검수된 데스크톱·모바일 스크린샷', async ({ page }) => {
  await page.goto('/login'); await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await capture(page, 'login-desktop')
  await login(page); await home(page); await capture(page, 'hub-desktop', true)
  await document(page); await capture(page, 'reader-desktop')
  await page.goto('/p/guide/design-system'); await expect(page.locator('article h1')).toBeVisible(); await capture(page, 'design-system-desktop')
  await page.locator('#catalog-interface').evaluate(el => el.scrollIntoView({ block: 'start' })); await capture(page, 'design-system-components-desktop')
  await home(page); await page.getByRole('button', { name: 'Workspace menu' }).click(); await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Team members', exact: true }).click(); await expect(page.getByText('review@moa.example', { exact: true })).toBeVisible(); await capture(page, 'settings-desktop')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 }); await home(page); await capture(page, 'hub-mobile')
  await document(page); await capture(page, 'reader-mobile')
  await page.getByRole('button', { name: 'Open document navigation' }).click(); await capture(page, 'navigation-mobile')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Open AI assistant' }).click(); await capture(page, 'chat-mobile')
})

test('글자 200% 확대와 동작 감소 설정', async ({ page }) => {
  await login(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const route of ['/', '/p/moa-design/long-content']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.evaluate(() => globalThis.document.fonts.ready)
      expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily.toLowerCase())).toContain('pretendard')
      await page.addStyleTag({ content: 'html { font-size: 200%; }' })
      await noOverflow(page)
    }
  }
})

test('공유 복사 실패 시 수동 복사와 포커스 복귀', async ({ page }) => {
  const sharesPath = path.join(reviewRoot, 'shares.json')
  const original = fs.readFileSync(sharesPath, 'utf8')
  try {
    await login(page); await document(page)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('검수용 클립보드 실패') } } })
      globalThis.document.execCommand = () => false
    })
    const share = page.getByRole('button', { name: 'Share', exact: true })
    await share.click()
    const dialog = page.getByRole('dialog', { name: 'Copy the link manually' })
    await expect(dialog).toBeVisible()
    await expect(page.getByLabel('Document share link')).toHaveValue(/\/s\/review-document-link-only$/)
    await page.keyboard.press('Escape'); await expect(share).toBeFocused()
    expect(await page.locator('textarea').count()).toBe(0)
  } finally { fs.writeFileSync(sharesPath, original) }
})

test('중지 응답이 늦어도 다음 AI 작업이 유지됨 (모의 스트림)', async ({ page }) => {
  await login(page); await document(page)
  await page.evaluate(() => {
    const fetchOriginal = window.fetch.bind(window)
    window.fixtureStreams = []
    window.fixtureStop = null
    window.fetch = (input, options) => {
      if (input === '/api/chat') {
        const index = window.fixtureStreams.length
        const state = { aborted: false }
        window.fixtureStreams.push(state)
        return Promise.resolve(new Response(new ReadableStream({
          start(controller) {
            state.controller = controller
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'moa-run', runId: `fixture-${index}` }) + '\n'))
            options.signal.addEventListener('abort', () => { state.aborted = true; controller.error(new DOMException('Aborted', 'AbortError')) })
          },
        }), { headers: { 'content-type': 'application/x-ndjson' } }))
      }
      if (input === '/api/chat/stop') return new Promise(resolve => { window.fixtureStop = () => resolve(new Response('{}')) })
      return fetchOriginal(input, options)
    }
  })
  await page.getByRole('button', { name: 'Open AI assistant' }).click()
  const input = page.getByRole('textbox', { name: 'Message to AI' })
  await input.fill('첫 번째 검수용 실행')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.fixtureStreams.length)).toBe(1)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText('Task stopped.', { exact: true })).toBeVisible()
  await input.fill('두 번째 검수용 실행')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.fixtureStreams.length)).toBe(2)
  await page.evaluate(() => window.fixtureStop())
  expect(await page.evaluate(() => window.fixtureStreams.map(stream => stream.aborted))).toEqual([true, false])
  await page.evaluate(() => {
    const controller = window.fixtureStreams[1].controller
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '두 번째 작업은 유지됩니다.' }] } }) + '\n'))
    controller.close()
  })
  await expect(page.getByText('두 번째 작업은 유지됩니다.', { exact: true })).toBeVisible()
})

test('MDX relative JSX/JSON imports and legacy class compatibility', async ({ page }) => {
  const dir = path.join(reviewRoot, 'projects/guide/import-check')
  const mdx = path.join(reviewRoot, 'projects/guide/import-check.mdx')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ title: '외부 JSON 예시' }))
  fs.writeFileSync(path.join(dir, 'local.jsx'), `import React from 'react'; export default function Local({ title }) { return <div className="card"><h2>{title}</h2><p>상대 경로 React 컴포넌트</p><div className="check done"><span className="txt">완료한 기존 체크</span></div></div> }`)
  fs.writeFileSync(mdx, `export const title = '기존 문서 호환 검수'\nimport Local from './import-check/local.jsx'\nimport data from './import-check/data.json'\n\n# 기존 문서 호환 검수\n\n<Local title={data.title}/>`)
  try {
    await login(page); await page.goto('/p/guide/import-check')
    await expect(page.getByRole('heading', { name: '외부 JSON 예시' })).toBeVisible()
    await expect(page.getByText('상대 경로 React 컴포넌트')).toBeVisible()
    await expect(page.getByText('완료한 기존 체크')).toHaveCSS('text-decoration-line', 'line-through')
    await noOverflow(page)
  } finally { fs.rmSync(mdx); fs.rmSync(dir, { recursive: true }) }
})


test('English table words stay intact while wide data scrolls inside the table on mobile', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/doc?slug=moa-design&doc=overview', route => route.fulfill({ json: { code: `
    const React = require('react');
    const {useMDXComponents} = require('@mdx-js/react');
    module.exports.default = function EnglishTable() {
      const {DataTable} = useMDXComponents();
      return React.createElement(React.Fragment, null,
        React.createElement('h1', null, 'English table readability'),
        React.createElement(DataTable, {
          cols: ['Workstream', 'Focus', 'Status', 'Reviewer'],
          rows: [['Documentation', 'Navigation', 'Complete', 'Reviewers'], ['Components', 'Accessibility', 'Progress', 'Teammates']]
        }));
    }` } }))
  await page.goto('/p/moa-design/overview')
  await expect(page.getByRole('heading', { name: 'English table readability' })).toBeVisible()
  await page.evaluate(() => globalThis.document.fonts.ready)
  const word = page.locator('article tbody th').first()
  const metrics = await word.evaluate(el => {
    const range = globalThis.document.createRange()
    range.selectNodeContents(el)
    return { lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size }
  })
  expect(metrics.lines).toBe(1)
  const table = page.getByRole('region', { name: 'Data table' })
  expect(await table.evaluate(el => el.scrollWidth)).toBeGreaterThan(await table.evaluate(el => el.clientWidth))
  await table.focus(); await page.keyboard.press('ArrowRight')
  await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await noOverflow(page)
})

test('Korean table words stay intact instead of breaking between syllables', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/doc?slug=moa-design&doc=overview', route => route.fulfill({ json: { code: `
    const React = require('react');
    const {useMDXComponents} = require('@mdx-js/react');
    module.exports.default = function KoreanTable() {
      const {table: Table} = useMDXComponents();
      const row = (label, flow) => React.createElement('tr', null, React.createElement('td', null, label), React.createElement('td', null, flow));
      return React.createElement(React.Fragment, null,
        React.createElement('h1', null, '한글 표 가독성'),
        React.createElement(Table, null,
          React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', null, '주차'), React.createElement('th', null, '흐름'))),
          React.createElement('tbody', null,
            row('5주 (초안)', '매일 에이전트와 의논해 시장 문서와 현재가를 읽고 주문 제안을 만든 뒤 사람이 승인하는 흐름을 연습한다'),
            row('6주 (초안)', '리서치와 매매와 리포트를 맡는 서브 에이전트로 팀을 나누고 승인 단계를 제거해 자동 투자로 넘어간다'))));
    }` } }))
  await page.goto('/p/moa-design/overview')
  await expect(page.getByRole('heading', { name: '한글 표 가독성' })).toBeVisible()
  await page.evaluate(() => globalThis.document.fonts.ready)
  const brokenWords = await page.locator('article tbody td').evaluateAll(cells => cells.flatMap(cell => {
    const node = cell.firstChild
    return [...node.data.matchAll(/\S+/g)].filter(match => {
      const range = globalThis.document.createRange()
      range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length)
      return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size > 1
    }).map(match => match[0])
  }))
  expect(brokenWords).toEqual([])
  await noOverflow(page)
})
