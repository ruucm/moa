// Claude integration — list .claude skills/agents, read session transcripts, headless runs.
// Logic ported as-is from a previous Vite middleware implementation.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ALLOW, inAllow } from './paths.mjs'

// Extract name/description from the YAML frontmatter of SKILL.md / agent md files (supports | and > block scalars)
const parseFrontmatter = (file) => {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') } catch { return {} }
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const lines = m[1].split('\n')
  const out = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/)
    if (!kv) continue
    let val = kv[2].trim()
    if (val === '|' || val === '>' || val === '|-' || val === '>-' || val === '') {
      const buf = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) buf.push(lines[++i].trim())
      val = buf.join(' ')
    }
    out[kv[1]] = val
  }
  return out
}

// Walk up from the registered path (which may be a docs folder) to find the project root containing .claude
export const findClaudeRoot = (start) => {
  let dir = path.resolve(start)
  while (inAllow(dir) && dir !== ALLOW) {
    if (fs.existsSync(path.join(dir, '.claude'))) return dir
    dir = path.dirname(dir)
  }
  return null
}

export const listClaude = (projPath) => {
  const root = findClaudeRoot(projPath)
  if (!root) return { skills: [], agents: [] }
  const cdir = path.join(root, '.claude')
  const skills = []
  try {
    for (const d of fs.readdirSync(path.join(cdir, 'skills'), { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue
      const skillMd = path.join(cdir, 'skills', d.name, 'SKILL.md')
      if (!fs.existsSync(skillMd)) continue
      const fm = parseFrontmatter(skillMd)
      skills.push({ name: fm.name || d.name, description: (fm.description || '').slice(0, 300) })
    }
  } catch {}
  const agents = []
  try {
    for (const f of fs.readdirSync(path.join(cdir, 'agents'))) {
      if (!f.endsWith('.md')) continue
      const fm = parseFrontmatter(path.join(cdir, 'agents', f))
      agents.push({ name: fm.name || f.replace(/\.md$/, ''), description: (fm.description || '').slice(0, 300) })
    }
  } catch {}
  return { root, skills, agents }
}

// ── Claude session transcripts (~/.claude/projects/<encoded-cwd>/*.jsonl) ──
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const SESSION_DIRS = new Map()

const readHead = (file, n) => {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(n)
    return buf.subarray(0, fs.readSync(fd, buf, 0, n, 0)).toString('utf8')
  } finally { fs.closeSync(fd) }
}

const jsonlFiles = (dir) => {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')) } catch { return [] }
}

// Try the encoding rule (`/` and `.` → `-`) first; if that misses, match each folder by the cwd on its first line.
const sessionDirFor = (root) => {
  if (SESSION_DIRS.has(root)) return SESSION_DIRS.get(root)
  let found = null
  const direct = path.join(CLAUDE_PROJECTS, root.replace(/[/.]/g, '-'))
  if (fs.existsSync(direct)) found = direct
  else {
    for (const name of (() => { try { return fs.readdirSync(CLAUDE_PROJECTS) } catch { return [] } })()) {
      const dir = path.join(CLAUDE_PROJECTS, name)
      const f = jsonlFiles(dir)[0]
      if (!f) continue
      try {
        if (JSON.parse(readHead(path.join(dir, f), 8192).split('\n')[0]).cwd === root) { found = dir; break }
      } catch {}
    }
  }
  if (found) SESSION_DIRS.set(root, found)
  return found
}

const blockText = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).join('')
  return ''
}

// Only user input worth rendering (excludes system-reminder, caveat, command stdout)
const realUserText = (t) => {
  const s = String(t || '').trim()
  return s && !s.startsWith('<') ? s : null
}

const toolLabel = (input) => {
  if (!input || typeof input !== 'object') return ''
  const v = input.command || input.pattern || input.file_path || input.path || input.url
    || input.description || input.skill || input.prompt || JSON.stringify(input)
  const s = String(v).replace(/\s+/g, ' ')
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

// Session list: uses the first user message as the title (reads only the head of the file)
export const listSessions = (root) => {
  const dir = sessionDirFor(root)
  if (!dir) return { dir: null, sessions: [] }
  const sessions = []
  for (const f of jsonlFiles(dir)) {
    const full = path.join(dir, f)
    let st
    try { st = fs.statSync(full) } catch { continue }
    let title = null
    try {
      for (const line of readHead(full, 96 * 1024).split('\n')) {
        if (!line.trim()) continue
        let d
        try { d = JSON.parse(line) } catch { continue }
        if (d.type !== 'user' || d.isSidechain || d.isMeta) continue
        const c = (d.message || {}).content
        const t = realUserText(Array.isArray(c) ? blockText(c.filter((b) => b && b.type === 'text')) : c)
        if (t) { title = t.slice(0, 120).replace(/\s+/g, ' '); break }
      }
    } catch {}
    sessions.push({ id: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, size: st.size, title })
  }
  sessions.sort((a, b) => b.mtime - a.mtime)
  return { dir, sessions: sessions.slice(0, 40) }
}

// Convert one session into the chat panel's item array (same shape as produced during streaming)
export const sessionItems = (root, id) => {
  const dir = sessionDirFor(root)
  if (!dir) return null
  const file = path.join(dir, id + '.jsonl')
  if (!file.startsWith(dir + '/') || !fs.existsSync(file)) return null
  const items = []
  const byToolId = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    if (d.isSidechain || d.isMeta) continue
    const content = ((d.message || {}).content) || null
    if (!content) continue
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: String(content) }]
    if (d.type === 'user') {
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue
        if (b.type === 'tool_result') {
          const it = byToolId.get(b.tool_use_id)
          if (it) { it.output = blockText(b.content).slice(0, 4000); it.isError = !!b.is_error }
        } else if (b.type === 'text') {
          const t = realUserText(b.text)
          if (t) items.push({ kind: 'user', text: t })
        }
      }
    } else if (d.type === 'assistant') {
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue
        if (b.type === 'text' && b.text.trim()) items.push({ kind: 'text', text: b.text })
        else if (b.type === 'tool_use') {
          const it = { kind: 'tool', id: b.id, name: b.name, label: toolLabel(b.input) }
          byToolId.set(b.id, it)
          items.push(it)
        }
      }
    }
  }
  // For long sessions (several MB), keep only the tail — resuming only needs recent context
  const MAX = 400
  return items.length > MAX
    ? { items: items.slice(-MAX), skipped: items.length - MAX }
    : { items, skipped: 0 }
}

// ── Headless runs ──
export const RUNS = new Map() // runId → child
let RUN_SEQ = 0
export const nextRunId = () => 'run-' + Date.now() + '-' + ++RUN_SEQ

export const findClaudeBin = () => {
  const cands = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]
  for (const c of cands) {
    try { fs.accessSync(c, fs.constants.X_OK); return c } catch {}
  }
  return 'claude' // fall back to PATH
}
