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

// Meta of a doc's source, as the sidebar reads it.
export const parseDocMeta = (src) => {
  const pick = (re) => { const m = src.match(re); return m ? m[2] : null }
  const num = (re) => { const m = src.match(re); return m ? Number(m[1]) : null }
  return {
    title: pick(litRe('title')),
    group: pick(litRe('group')),
    date: pick(litRe('date')),
    order: num(numRe('order')),
  }
}

export const docMeta = (absPath) => {
  let st
  try { st = fs.statSync(absPath) } catch { return null }
  const hit = metaCache.get(absPath)
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.meta
  let src = ''
  try { src = fs.readFileSync(absPath, 'utf8') } catch {}
  const meta = { ...parseDocMeta(src), mtime: Math.round(st.mtimeMs) }
  metaCache.set(absPath, { mtimeMs: st.mtimeMs, meta })
  return meta
}

// Rewrites a doc's title or group literal in its source — renaming a page or moving it to another group from the
// sidebar. `changes` holds plain text on one line ('' as the group takes the page out of its group). An existing
// literal is replaced where it stands and the rest of the file is kept byte for byte; a missing one is added next
// to the other meta exports. The text goes between quotes it doesn't contain — the literal's own quote or ' when
// they can, a backtick only when nothing else will — so the regex above reads back exactly that text.
// Returns { src } or, when the text can't be written as such a literal, { error }.
const QUOTES = ["'", '"', '`']
const META_LINE = /^export\s+const\s+(?:title|group|order|date)\s*=/m

export const setDocMeta = (source, changes) => {
  let src = source
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  for (const name of ['title', 'group']) {
    const text = changes[name]
    if (text === undefined) continue
    if (/[\\\r\n\u2028\u2029]/.test(text)) return { error: `The ${name} must be one line, without a backslash.` }
    const found = litRe(name).exec(src)
    // The same name declared some other way (an expression, `let`) would clash with an added literal.
    if (!found && new RegExp(`^export\\s+(?:const|let|var)\\s+${name}\\b`, 'm').test(src))
      return { error: `This page sets its ${name} in code, so it can't be changed here. Edit the file instead.` }
    if (!found && text === '') continue
    const quote = [found?.[1] !== '`' && found?.[1], ...QUOTES].find((q) => q && !text.includes(q) && !(q === '`' && text.includes('${')))
    if (!quote) return { error: `The ${name} can't use all three kinds of quote marks (' " \`).` }
    const literal = quote + text + quote
    if (found) {
      const start = found.index + found[0].length - found[2].length - 2
      src = src.slice(0, start) + literal + src.slice(found.index + found[0].length)
      continue
    }
    const line = `export const ${name} = ${literal}`
    // A group goes on the line after the title; a title, or a group without one, before the first meta export.
    const title = name === 'group' && litRe('title').exec(src)
    if (title) {
      const end = src.indexOf('\n', title.index + title[0].length)
      src = end < 0 ? src + eol + line : src.slice(0, end + 1) + line + eol + src.slice(end + 1)
      continue
    }
    const meta = META_LINE.exec(src)
    if (meta) {
      src = src.slice(0, meta.index) + line + eol + src.slice(meta.index)
      continue
    }
    // No meta at all: the export opens the file, a blank line apart from Markdown that follows (MDX reads the lines
    // up to a blank one as JavaScript).
    const bom = src.startsWith('\uFEFF') ? 1 : 0
    const first = src.slice(bom).split(/\r?\n/, 1)[0]
    const joined = !first.trim() || /^(?:import|export)\s/.test(first)
    src = src.slice(0, bom) + line + eol + (joined ? '' : eol) + src.slice(bom)
  }
  // The sidebar must read back the new text, and every other meta as it was.
  const before = parseDocMeta(source)
  const after = parseDocMeta(src)
  const expected = (key) => {
    const text = changes[key]
    if (text === undefined) return before[key]
    return text === '' && before[key] === null ? null : text
  }
  for (const key of Object.keys(after))
    if (!Object.is(after[key], expected(key))) return { error: `Could not update the ${key} of this page. Edit the file instead.` }
  return { src }
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
    if (r.description != null) p.description = r.description // '' hides a description the folder's _meta.json would give
    p.status = r.status || p.status || 'active'
    if (r.order != null) p.order = r.order
  }
  for (const [slug, n] of Object.entries(reg.order || {})) if (bySlug[slug]) bySlug[slug].order = n
  // The top of the sidebar's list as an admin dragged it into place (POST /api/order/groups): group names, and
  // { doc } for a page outside any group
  for (const [slug, items] of Object.entries(reg.groupOrder || {}))
    if (bySlug[slug] && Array.isArray(items)) bySlug[slug].groupOrder = items
      .filter((item) => typeof item === 'string' || typeof item?.doc === 'string')
      .map((item) => typeof item === 'string' ? item : { doc: item.doc })
  // Pages and whole groups an admin archived (POST /api/archive): out of the sidebar's list, in its Archived group
  for (const [slug, saved] of Object.entries(reg.archived || {})) {
    if (!bySlug[slug] || !saved || typeof saved !== 'object') continue
    const names = (list) => Array.isArray(list) ? list.filter((name) => typeof name === 'string') : []
    const archived = { groups: names(saved.groups), docs: names(saved.docs) }
    if (archived.groups.length || archived.docs.length) bySlug[slug].archived = archived
  }
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
