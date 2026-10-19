// Search across every document a reader may open — by title, group, project and the words on the page.
// The text of each .mdx is read once and kept in memory until the file changes (keyed by the mtime the
// index already took), so a search over the whole hub scans cached text instead of reading every file.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './paths.mjs'

export const MAX_QUERY = 200
const MAX_TERMS = 8
const EXCERPT_BEFORE = 60
const EXCERPT_AFTER = 110
const LEAD_LENGTH = 140

// Where a term may land, heaviest first: a word of the title says most about a page, a word of its text least.
const WEIGHTS = { title: 10, name: 5, group: 4, project: 3, text: 1 }
const FIELDS = Object.keys(WEIGHTS)
// Pages of the project the reader is in rank above equal matches elsewhere, but below a better match anywhere.
const HOME_BOOST = 2

const textCache = new Map() // absolute path → { mtime, text, lower }

const normalize = (value) => String(value || '').normalize('NFC')
// Lower-cased for matching. The folded string keeps the length of the original where it can, so an index found
// in it also points into the original; the rare script where lower-casing changes the length matches as is.
const fold = (value) => {
  const normalized = normalize(value)
  for (const lower of [normalized.toLocaleLowerCase(), normalized.toLowerCase()]) if (lower.length === normalized.length) return lower
  return normalized
}

// The readable text of a document: meta exports, imports, tags, markdown marks and URLs are dropped, so a
// match lands on words the reader sees on the page and an excerpt reads like the page.
export const plainText = (source) => String(source || '')
  .replace(/\r\n?/g, '\n')
  .replace(/^import\s[^\n]*$/gm, ' ')
  .replace(/^export\s+(?:const|let|var|default|function)\b[^\n]*$/gm, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/^```[^\n]*$/gm, ' ')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
  .replace(/<\/?[A-Za-z][^<>]*>/g, ' ')
  .replace(/(?:https?:\/\/|data:)[^\s)'"]+/g, ' ')
  .replace(/[{}[\]`*_>#|~\\]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// The distinct words of a query, folded for matching — at most MAX_TERMS of them from the first MAX_QUERY characters.
export const queryTerms = (q) => [...new Set(fold(q).slice(0, MAX_QUERY).split(/\s+/).filter(Boolean))].slice(0, MAX_TERMS)

const docText = (abs, mtime) => {
  const hit = textCache.get(abs)
  if (hit && hit.mtime === mtime) return hit
  let source = ''
  try { source = fs.readFileSync(abs, 'utf8') } catch {}
  const text = normalize(plainText(source))
  const entry = { mtime, text, lower: fold(text) }
  textCache.set(abs, entry)
  return entry
}

// A piece of the text around the earliest term found in it, cut at word boundaries — or the start of the page.
const excerptOf = ({ text, lower }, terms) => {
  let at = -1
  for (const term of terms) {
    const index = lower.indexOf(term)
    if (index >= 0 && (at < 0 || index < at)) at = index
  }
  if (at < 0) return text.length > LEAD_LENGTH ? text.slice(0, LEAD_LENGTH).replace(/\s+\S*$/, '') + '…' : text
  let start = Math.max(0, at - EXCERPT_BEFORE)
  let end = Math.min(text.length, at + EXCERPT_AFTER)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space >= 0 && space < at) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > at) end = space
  }
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

// How well a page answers the terms: every term must occur in some field, and the heaviest field each term
// lands in counts. `match` names the heaviest field any term landed in.
const scoreDoc = (fields, terms) => {
  let score = 0
  let match = null
  for (const term of terms) {
    const field = FIELDS.find((name) => fields[name].includes(term))
    if (!field) return null
    score += WEIGHTS[field]
    if (field === 'title') score += (fields.title.startsWith(term) ? 3 : 0) + (fields.title === term ? 5 : 0)
    if (!match || WEIGHTS[field] > WEIGHTS[match]) match = field
  }
  return { score, match }
}

const describe = (project, doc) => ({
  slug: project.slug, project: project.title || project.slug, demo: !!project.demo,
  doc: doc.slug, title: doc.title, group: doc.group || null, date: doc.date || null, mtime: doc.mtime || null,
})

// The pages among `projects` (already limited to what the reader may open) that match `q`, best first, each
// with an excerpt of the page around the match. Without a query: the most recently updated pages, no excerpt.
// `from` is the project the reader is in — its pages rank above equal matches elsewhere.
export const searchDocs = (projects, q, { from = null, limit = 40 } = {}) => {
  const terms = queryTerms(q)
  if (!terms.length) {
    const recent = projects.flatMap((project) => project.docs.map((doc) => describe(project, doc)))
      .filter((item) => item.mtime).sort((a, b) => b.mtime - a.mtime)
    return { terms, total: recent.length, results: recent.slice(0, limit) }
  }
  const seen = new Set()
  const hits = []
  for (const project of projects) {
    const projectName = fold(project.title || project.slug)
    for (const doc of project.docs) {
      const abs = path.join(ROOT, project.root || 'projects', project.slug, doc.slug + '.mdx')
      seen.add(abs)
      const entry = docText(abs, doc.mtime)
      const hit = scoreDoc({ title: fold(doc.title), name: fold(doc.slug), group: fold(doc.group), project: projectName, text: entry.lower }, terms)
      if (!hit) continue
      hits.push({ ...describe(project, doc), excerpt: excerptOf(entry, terms), match: hit.match, score: hit.score + (project.slug === from ? HOME_BOOST : 0) })
    }
  }
  for (const key of textCache.keys()) if (!seen.has(key)) textCache.delete(key)
  hits.sort((a, b) => b.score - a.score || (b.mtime || 0) - (a.mtime || 0) || a.title.localeCompare(b.title))
  return { terms, total: hits.length, results: hits.slice(0, limit) }
}
