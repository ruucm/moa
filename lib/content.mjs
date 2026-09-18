// Project/doc index — replaces the old vite import.meta.glob(eager) with an fs scan at request time.
// Doc meta (title/group/order/date) is extracted from source via regex, literals only.
// The file mtime rides along so the sidebar can order groups by their last update.
// No execution needed, so a broken .mdx leaves the index intact — only that doc shows an error at render time.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, PROJECTS, REGISTRY } from './paths.mjs'

export const readRegistry = () => {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) } catch { return { projects: [] } }
}
export const writeRegistry = (r) => fs.writeFileSync(REGISTRY, JSON.stringify(r, null, 2) + '\n')

// Doc meta cache — skip re-parsing when mtime is unchanged
const metaCache = new Map() // absPath → { mtimeMs, meta }

const litRe = (name) => new RegExp(`^export\\s+const\\s+${name}\\s*=\\s*(['"\`])([\\s\\S]*?)\\1`, 'm')
const numRe = (name) => new RegExp(`^export\\s+const\\s+${name}\\s*=\\s*(-?[\\d.]+)`, 'm')

export const docMeta = (absPath) => {
  let st
  try { st = fs.statSync(absPath) } catch { return null }
  const hit = metaCache.get(absPath)
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.meta
  let src = ''
  try { src = fs.readFileSync(absPath, 'utf8') } catch {}
  const pick = (re) => { const m = src.match(re); return m ? m[2] : null }
  const num = (re) => { const m = src.match(re); return m ? Number(m[1]) : null }
  const meta = {
    title: pick(litRe('title')),
    group: pick(litRe('group')),
    date: pick(litRe('date')),
    order: num(numRe('order')),
    mtime: Math.round(st.mtimeMs),
  }
  metaCache.set(absPath, { mtimeMs: st.mtimeMs, meta })
  return meta
}

const scanRoot = (rootRel, demo) => {
  const base = path.join(ROOT, rootRel)
  const out = []
  let entries = []
  try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const dir = path.join(base, e.name)
    let st
    try { st = fs.statSync(dir) } catch { continue } // skip broken symlinks
    if (!st.isDirectory()) continue
    const p = { slug: e.name, root: rootRel, demo, title: e.name, docs: [] }
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'))
      Object.assign(p, m)
    } catch {}
    let files = []
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.mdx')) } catch {}
    for (const f of files) {
      const abs = path.join(dir, f)
      const meta = docMeta(abs) || {}
      p.docs.push({
        slug: f.replace(/\.mdx$/, ''),
        title: meta.title || f.replace(/\.mdx$/, ''),
        group: meta.group || null,
        order: meta.order ?? 99,
        date: meta.date || null,
        mtime: meta.mtime || null,
      })
    }
    out.push(p)
  }
  return out
}

// Full index — same rules as the old main.jsx projects/allList construction logic
export const buildIndex = () => {
  const reg = readRegistry()
  const bySlug = {}
  for (const p of [...scanRoot('projects', false), ...scanRoot('demo/projects', true)])
    bySlug[p.slug] = p
  for (const r of reg.projects || []) {
    const p = bySlug[r.slug] || (bySlug[r.slug] = { slug: r.slug, root: 'projects', demo: false, docs: [] })
    p.registered = true
    p.path = r.path
    p.title = r.title || p.title || r.slug
    if (r.description) p.description = r.description
    p.status = r.status || p.status || 'active'
    if (r.order != null) p.order = r.order
  }
  for (const [slug, n] of Object.entries(reg.order || {})) if (bySlug[slug]) bySlug[slug].order = n
  const all = Object.values(bySlug)
    .map((p) => {
      p.docs.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      p.updated = p.docs.map((d) => d.date).filter(Boolean).sort().at(-1) || null
      return p
    })
    .filter((p) => p.docs.length > 0 || p.registered)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title))
  return { projects: all, hidden: reg.hidden || [], registryProjects: reg.projects || [] }
}

// Absolute path of a doc file (realpath, so esbuild resolves relative imports when the project folder is a symlink)
export const docPath = (slug, doc) => {
  if (!/^[\w.\-가-힣 ]+$/.test(slug) || !/^[\w.\-가-힣 ]+$/.test(doc)) return null
  for (const rootRel of ['projects', 'demo/projects']) {
    const p = path.join(ROOT, rootRel, slug, doc + '.mdx')
    try { return fs.realpathSync(p) } catch {}
  }
  return null
}
