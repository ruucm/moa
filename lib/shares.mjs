// Page share tokens — shares.json holds a list of { token, slug, doc, media, api, createdAt }.
// Revocation (remove) is immediate: the doc API checks shares.json on every request, so the page dies right away;
// only already-issued media cookies linger for at most SHARE_TTL (6h).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { SHARES, PUBLIC } from './paths.mjs'
import { docPath, docMeta, buildIndex } from './content.mjs'

export const readShares = () => {
  try { return JSON.parse(fs.readFileSync(SHARES, 'utf8')) } catch { return { shares: [] } }
}
const writeShares = (s) => fs.writeFileSync(SHARES, JSON.stringify(s, null, 2) + '\n')

// ── What a share may load ─────────────────────────────────────────────────────────────────────────────
// A shared page shows media from public/ that its sources name: the .mdx and everything it imports through a
// relative path — ../src/*.jsx components, their JSON/CSV data, raw .md — because that is often where the image
// paths are (a gallery component and the list of photos it shows). The scope is the top-level public/ entries
// those sources name — '/<folder>/' (a prefix) or '/<file>' (that path only) — plus the review proxies the .mdx
// itself names (api="/studio"); a component's default (ClipReview's '/reviewapi') opens no proxy to guests.
// It is read from the sources again whenever a guest cookie is minted (opening /s/<token>, loading the page),
// so media a page gains after it was shared opens too.

const TEXT = /\.(?:mdx?|[cm]?[jt]sx?|json|csv|css|txt|svg)$/i
const CODE = /\.(?:mdx|[cm]?[jt]sx?)$/i
const EXTS = ['.jsx', '.js', '.mjs', '.cjs', '.tsx', '.ts', '.json', '.mdx', '.md', '.csv', '.css']
// import x from './a' · import './a' · export { x } from './a' · export * from './a' · import('./a') · require('./a')
const IMPORT = /\b(?:import\s*(?:[\w$*{}\s,]+?\s*from\s*)?|export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*|import\s*\(\s*|require\s*\(\s*)(['"])(\.\.?\/[^'"\n]*)\1/g
const MAX_SOURCES = 300
const MAX_BYTES = 16 * 1024 * 1024

const isFile = (f) => { try { return fs.statSync(f).isFile() } catch { return false } }
// The file a relative import names, as the bundler finds it: as written, with an extension, or a folder's index.
const resolveImport = (from, spec) => {
  const base = path.resolve(path.dirname(from), spec.replace(/[?#].*$/, ''))
  if (isFile(base)) return base
  for (const ext of EXTS) if (isFile(base + ext)) return base + ext
  for (const ext of EXTS) if (isFile(path.join(base, 'index' + ext))) return path.join(base, 'index' + ext)
  return null
}

// The doc and every text file it imports through relative paths, the doc first — [{ file, text }].
export const docSources = (abs) => {
  const out = []
  const seen = new Set([abs])
  const queue = [abs]
  let bytes = 0
  while (queue.length && out.length < MAX_SOURCES) {
    const file = queue.shift()
    let text
    try {
      const size = fs.statSync(file).size
      if (bytes + size > MAX_BYTES) continue
      text = fs.readFileSync(file, 'utf8')
      bytes += size
    } catch { continue }
    out.push({ file, text })
    if (!CODE.test(file)) continue
    for (const m of text.matchAll(IMPORT)) {
      const dep = resolveImport(file, m[2])
      if (dep && TEXT.test(dep) && !seen.has(dep)) { seen.add(dep); queue.push(dep) }
    }
  }
  return out
}

// Text as the page will use it — JSON written with escaped characters (\uXXXX, \/) names the same paths.
const unescapeText = (t) => t
  .replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g, (all, a, b) => {
    try { return String.fromCodePoint(parseInt(a || b, 16)) } catch { return all }
  })
  .replace(/\\\//g, '/')

// The first segment of a site-root path, wherever one can start — after a quote, the ( of url() or a markdown
// link, = , [ { > : ; or a space — and the first segment after an origin (http://host/<segment>/…).
const ROOT_SEG = /(?<![^\s"'`(=,[{>:;])\/([^/\s"'`()<>{}[\]\\|?#,;]+)/g
const URL_SEG = /\bhttps?:\/\/[^/\s"'`<>]+\/([^/\s"'`()<>{}[\]\\|?#,;]+)/g
// App routes — never media, whatever public/ holds.
const RESERVED = new Set(['api', '_next', 'p', 's', 'login', 'join', 'reset'])
// Proxied review tools — /studio/*, /reviewapi*, /r53xx — and the proxies configured in MOA_PROXIES (next.config.mjs),
// which are never media either.
const PROXY = /\/(reviewapi\d*|studio|r53\d\d)(?=["'`/\s)])/g
const proxyKeys = () => (process.env.MOA_PROXIES || '').split(',').map((s) => s.trim().split(':')[0]).filter(Boolean)

// Top-level entries of public/ — Map(NFC name → is a folder). A symlink counts as what it points to.
const publicTop = () => {
  const top = new Map()
  let entries = []
  try { entries = fs.readdirSync(PUBLIC, { withFileTypes: true }) } catch { return top }
  for (const e of entries) {
    let dir = e.isDirectory()
    if (e.isSymbolicLink()) {
      try { dir = fs.statSync(path.join(PUBLIC, e.name)).isDirectory() } catch { continue }
    } else if (!dir && !e.isFile()) continue
    top.set(e.name.normalize('NFC'), dir)
  }
  return top
}

export const scanSources = (sources) => {
  const top = publicTop()
  const proxies = new Set(proxyKeys())
  const media = new Set()
  const api = new Set()
  const take = (seg) => {
    let name = seg
    try { name = decodeURIComponent(seg) } catch {}
    name = name.normalize('NFC')
    if (RESERVED.has(name) || proxies.has(name) || !top.has(name)) return
    media.add(top.get(name) ? `/${name}/` : `/${name}`)
  }
  for (const { text } of sources) {
    const t = unescapeText(text)
    for (const m of t.matchAll(ROOT_SEG)) take(m[1])
    for (const m of t.matchAll(URL_SEG)) take(m[1])
  }
  for (const m of (sources[0]?.text || '').matchAll(PROXY)) api.add('/' + m[1])
  return { media: [...media].sort(), api: [...api].sort() }
}

// Scope of one doc — { media, api }. Reused while no source file (and no top-level public/ entry) has changed.
const scopeCache = new Map() // absPath → { stamp, files, scope }
const stampOf = (files) => [PUBLIC, ...files].map((f) => { try { return fs.statSync(f).mtimeMs } catch { return 0 } }).join(',')

export const docScope = (abs) => {
  if (!abs) return { media: [], api: [] }
  const hit = scopeCache.get(abs)
  if (hit && hit.stamp === stampOf(hit.files)) return hit.scope
  const sources = docSources(abs)
  const files = sources.map((s) => s.file)
  const scope = scanSources(sources)
  scopeCache.set(abs, { stamp: stampOf(files), files, scope })
  return scope
}

// Signed-cookie payload for a share guest. The scope is read from the doc's sources now, not taken from when
// the share was made, so the page's current media opens.
export const guestScope = (share, exp) => {
  const { media, api } = docScope(docPath(share.slug, share.doc))
  return { t: share.token, s: share.slug, d: share.doc, m: media, a: api, exp }
}

export const createShare = (slug, doc) => {
  const abs = docPath(slug, doc)
  if (!abs) return { error: 'Document not found: ' + slug + '/' + doc }
  const all = readShares()
  const existing = all.shares.find((s) => s.slug === slug && s.doc === doc)
  const { media, api } = docScope(abs)
  if (existing) { // keep the existing token instead of reissuing; just refresh the scope (the doc may have changed)
    existing.media = media
    existing.api = api
    writeShares(all)
    return { share: existing }
  }
  const share = {
    token: crypto.randomBytes(18).toString('base64url'),
    slug, doc, media, api,
    createdAt: new Date().toISOString(),
  }
  all.shares.push(share)
  writeShares(all)
  return { share }
}

export const findShare = (token) => readShares().shares.find((s) => s.token === token) || null
export const findShareFor = (slug, doc) =>
  readShares().shares.find((s) => s.slug === slug && s.doc === doc) || null

// Image pixel size — for og:image:width/height (jpeg/png only, null on failure)
const imageDims = (file) => {
  try {
    const buf = fs.readFileSync(file)
    if (buf[0] === 0x89 && buf[1] === 0x50) // PNG: width/height from IHDR
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: look for the SOF marker
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue }
        const marker = buf[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
        i += 2 + buf.readUInt16BE(i + 2)
      }
    }
  } catch {}
  return null
}

// Share preview (OG) data — for link scrapers (chat apps, e.g. KakaoTalk, and Facebook).
// The thumbnail is the first image named in the doc's sources (the .mdx, then what it imports) that exists under public/.
export const shareOg = (share) => {
  const abs = docPath(share.slug, share.doc)
  const meta = (abs && docMeta(abs)) || {}
  const project = buildIndex().projects.find((p) => p.slug === share.slug)
  let image = null
  if (abs) {
    find: for (const { text } of docSources(abs)) {
      for (const m of unescapeText(text).matchAll(/\/[^\/"'`)\s?#]+\/[^"'`)\s?#]*\.(?:jpg|jpeg|png|webp|gif)/gi)) {
        let rel = m[0]
        try { rel = decodeURI(rel) } catch {}
        const file = path.join(PUBLIC, rel)
        // ignore paths that escape public/
        if (!path.resolve(file).startsWith(PUBLIC + path.sep)) continue
        try {
          if (fs.statSync(file).isFile()) {
            image = { rel, file, ext: path.extname(file).toLowerCase(), dims: imageDims(file) }
            break find
          }
        } catch {}
      }
    }
  }
  return {
    title: [meta.title, project && project.title].filter(Boolean).join(' · ') || share.doc,
    description: (project && project.description) || 'MOA report',
    image,
  }
}

export const removeShare = (token) => {
  const all = readShares()
  const idx = all.shares.findIndex((s) => s.token === token)
  if (idx < 0) return false
  all.shares.splice(idx, 1)
  writeShares(all)
  return true
}
