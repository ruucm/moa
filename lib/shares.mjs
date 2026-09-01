// Page share tokens — shares.json holds a list of { token, slug, doc, media, api, createdAt }.
// Revocation (remove) is immediate: the doc API checks shares.json on every request, so the page dies right away;
// only already-issued media cookies linger for at most SHARE_TTL (6h).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, SHARES } from './paths.mjs'
import { docPath, docMeta, buildIndex } from './content.mjs'

export const readShares = () => {
  try { return JSON.parse(fs.readFileSync(SHARES, 'utf8')) } catch { return { shares: [] } }
}
const writeShares = (s) => fs.writeFileSync(SHARES, JSON.stringify(s, null, 2) + '\n')

// Auto-collect absolute-path references (/slug/file) and proxy API prefixes from the doc source.
// Media = first segment of "/xxx/..." paths; APIs = /reviewapiN, /studio, /r53xx patterns.
const scanDoc = (abs) => {
  let src = ''
  try { src = fs.readFileSync(abs, 'utf8') } catch {}
  const media = new Set()
  const addSeg = (seg) => {
    if (!/^\/(api($|\/)|reviewapi|studio($|\/)|r53\d|_next|p\/|s\/|login)/.test(seg)) media.add(seg + '/')
  }
  // "/slug/file…" style references
  for (const m of src.matchAll(/["'`(=]\s*(\/[^\/"'`)\s?#]+)\//g)) addSeg(m[1])
  // Root constants/props without a trailing slash — export const U = '/media-dir…' / media="/media-dir…"
  for (const m of src.matchAll(/["'`](\/[^\/"'`)\s?#]+)["'`]/g)) addSeg(m[1])
  const api = new Set()
  for (const m of src.matchAll(/\/(reviewapi\d*|studio|r53\d\d)(?=["'`\/\s)])/g)) api.add('/' + m[1])
  return { media: [...media], api: [...api] }
}

export const createShare = (slug, doc) => {
  const abs = docPath(slug, doc)
  if (!abs) return { error: 'Document not found: ' + slug + '/' + doc }
  const all = readShares()
  const existing = all.shares.find((s) => s.slug === slug && s.doc === doc)
  const { media, api } = scanDoc(abs)
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
// The thumbnail is the first image referenced in the doc source that actually exists under public/.
export const shareOg = (share) => {
  const abs = docPath(share.slug, share.doc)
  const meta = (abs && docMeta(abs)) || {}
  const project = buildIndex().projects.find((p) => p.slug === share.slug)
  let image = null
  if (abs) {
    let src = ''
    try { src = fs.readFileSync(abs, 'utf8') } catch {}
    for (const m of src.matchAll(/\/[^\/"'`)\s?#]+\/[^"'`)\s?#]*\.(?:jpg|jpeg|png|webp|gif)/gi)) {
      const rel = decodeURI(m[0])
      const file = path.join(ROOT, 'public', rel)
      // ignore paths that escape public/
      if (!path.resolve(file).startsWith(path.join(ROOT, 'public') + path.sep)) continue
      try {
        if (fs.statSync(file).isFile()) {
          image = { rel, file, ext: path.extname(file).toLowerCase(), dims: imageDims(file) }
          break
        }
      } catch {}
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
