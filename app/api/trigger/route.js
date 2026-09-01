// POST /api/trigger — { slug, kind: 'skill'|'agent', name } run claude in Terminal.app (owner only)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readRegistry } from '../../../lib/content.mjs'
import { listClaude } from '../../../lib/claude.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  if (process.platform !== 'darwin') return j({ error: 'Only supported on macOS.' }, 501)
  const { slug, kind, name } = await req.json().catch(() => ({}))
  const proj = readRegistry().projects.find((r) => r.slug === slug)
  if (!proj) return j({ error: 'Not a registered project: ' + slug }, 404)
  const c = listClaude(proj.path)
  const known = (kind === 'agent' ? c.agents : c.skills).some((x) => x.name === name)
  if (!known) return j({ error: `${kind} "${name}" not found.` }, 404)
  const prompt = kind === 'agent' ? `Use the ${name} subagent.` : `/${name}`
  const sq = (s) => `'` + String(s).replace(/'/g, `'\\''`) + `'`
  // Instead of osascript (needs automation permission), open a temp script via open -a Terminal — no TCC permission required.
  const title = `${slug} · ${name}`.replace(/[^\w.\- ·가-힣]/g, '-')
  const runner = path.join(os.tmpdir(), `moa-trigger-${Date.now()}.command`)
  fs.writeFileSync(runner, [
    '#!/bin/zsh -l',
    `printf '\\033]0;%s\\007' ${sq(title)}`,
    `cd ${sq(c.root)} || exit 1`,
    `echo ${sq('▸ ' + c.root)}`,
    `echo ${sq('▸ claude ' + prompt)}`,
    `claude ${sq(prompt)}`,
    '',
  ].join('\n'), { mode: 0o755 })
  spawn('open', ['-a', 'Terminal', runner], { stdio: 'ignore', detached: true }).unref()
  return j({ ok: true, root: c.root, command: `claude "${prompt}"` })
}
