import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { reviewRoot } from '../scripts/review-fixtures.mjs'
import { login } from './review-session.mjs'

// A shared page shows the media its imported components and data files name, not only what the .mdx names itself —
// a gallery component with its list of photos is the usual case. The guest scope is read from the sources whenever
// the cookie is minted, so media added after sharing opens on the next load. A guest still gets nothing else from
// public/, and a dot segment (%2F..%2F, %2E%2E) cannot carry a path past the gate.
// The review server serves this checkout's public/ — the test writes its own folders there and removes them.
const pub = path.resolve('public')
const docs = path.join(reviewRoot, 'projects', 'moa-design')
const parts = path.join(docs, 'share-media-parts') // a subfolder: the sidebar lists only top-level .mdx files
const doc = path.join(docs, 'share-media.mdx')
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${fill}"/></svg>`
const files = {
  'review-share-gallery/one.svg': svg('#e8590c'),
  'review-share-gallery/two.svg': svg('#1971c2'),
  'review-share-data/three.svg': svg('#2f9e44'),
  'review-share-top.svg': svg('#7048e8'),
  'review-share-private/secret.svg': svg('#000'),
}
const folders = ['review-share-gallery', 'review-share-data', 'review-share-private', 'review-share-later']

const gallery = (extra = '') => `import data from './photos.json'
const BASE = '/review-share-gallery'
export function Gallery() {
  return <div data-testid="gallery">
    <img alt="one" src={\`\${BASE}/one.svg\`} />
    <img alt="two" src={BASE + '/two.svg'} />
    {data.map((p) => <img key={p.src} alt={p.alt} src={p.src} />)}
    ${extra}
  </div>
}
`
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }

// A request sent with its path exactly as written — fetch and Playwright resolve %2E%2E before sending.
const raw = (base, rawPath, cookie) => new Promise((resolve, reject) => {
  const u = new URL(base)
  const req = http.get({ host: u.hostname, port: u.port, path: rawPath, headers: cookie ? { cookie } : {} }, (res) => { res.resume(); resolve(res.statusCode) })
  req.on('error', reject)
  req.setTimeout(15000, () => req.destroy(new Error('timeout')))
})

test.describe('shared page media', () => {
  const sharesFile = path.join(reviewRoot, 'shares.json')
  let shares
  test.beforeAll(() => {
    shares = fs.readFileSync(sharesFile, 'utf8')
    for (const [name, text] of Object.entries(files)) write(path.join(pub, name), text)
    // escaped the way a JSON writer may: \/ and \u — the page reads the same path
    write(path.join(parts, 'photos.json'), '[{"src": "\\/review-share-\\u0064ata\\/three.svg", "alt": "three"}]\n')
    write(path.join(parts, 'gallery.jsx'), gallery())
    write(doc, `export const title = 'Shared media'\nexport const group = '검수'\nexport const order = 30\n\nimport { Gallery } from './share-media-parts/gallery.jsx'\n\n# Shared media\n\n<Gallery />\n\n![top](/review-share-top.svg)\n`)
  })
  test.afterAll(() => {
    fs.writeFileSync(sharesFile, shares)
    fs.rmSync(doc, { force: true })
    fs.rmSync(parts, { recursive: true, force: true })
    for (const f of folders) fs.rmSync(path.join(pub, f), { recursive: true, force: true })
    fs.rmSync(path.join(pub, 'review-share-top.svg'), { force: true })
  })

  test('a guest sees the images the page imports, and nothing else from public/', async ({ page, browser, baseURL }) => {
    await login(page)
    const made = await page.request.post('/api/share', { data: { slug: 'moa-design', doc: 'share-media' } })
    expect(made.ok()).toBeTruthy()
    const { share } = await made.json()
    expect(share.media).toEqual(['/review-share-data/', '/review-share-gallery/', '/review-share-top.svg'])

    const guest = await browser.newContext({ baseURL })
    const view = await guest.newPage()
    const loaded = (names) => expect.poll(() => view.evaluate((names) => names.map((n) => {
      const img = document.querySelector(`img[alt="${n}"]`)
      return !!img && img.complete && img.naturalWidth > 0
    }), names)).toEqual(names.map(() => true))
    await view.goto(`/s/${share.token}`)
    await expect(view.getByRole('heading', { name: 'Shared media', exact: true })).toBeVisible()
    await loaded(['one', 'two', 'three', 'top'])

    // Media the page gains after it was shared: the scope is read again when the page loads.
    write(path.join(pub, 'review-share-later/four.svg'), svg('#c2255c'))
    write(path.join(parts, 'gallery.jsx'), gallery('<img alt="four" src="/review-share-later/four.svg" />'))
    await view.reload()
    await expect(view.getByRole('heading', { name: 'Shared media', exact: true })).toBeVisible()
    await loaded(['one', 'two', 'three', 'top', 'four'])

    // Nothing outside the scope — asked for directly, through an encoded slash, or behind a dot segment.
    expect((await view.request.get('/review-share-private/secret.svg')).status()).toBe(401)
    const cookie = (await guest.cookies()).filter((c) => c.name === 'moa_share').map((c) => `${c.name}=${c.value}`).join('; ')
    expect(cookie).not.toBe('')
    expect(await raw(baseURL, '/review-share-gallery/one.svg', cookie)).toBe(200)
    expect(await raw(baseURL, '/review-share-gallery%2F..%2Freview-share-private%2Fsecret.svg', cookie)).toBe(400)
    expect(await raw(baseURL, '/review-share-gallery/..%2freview-share-private/secret.svg', cookie)).toBe(400)
    await guest.close()
  })

  test('a dot segment never carries a request past the gate', async ({ baseURL }) => {
    expect(await raw(baseURL, '/review-share-private/secret.svg')).toBe(401)
    expect(await raw(baseURL, '/_next/%2E%2E/review-share-private/secret.svg')).toBe(401)
    expect(await raw(baseURL, '/_next/static/%2e%2e/%2e%2e/review-share-private/secret.svg')).toBe(401)
    expect(await raw(baseURL, '/s/x%2F..%2F..%2Freview-share-private%2Fsecret.svg')).toBe(400)
    expect(await raw(baseURL, '/join/x%2F%2E%2E%2F..%2Freview-share-private/secret.svg')).toBe(400)
  })
})
