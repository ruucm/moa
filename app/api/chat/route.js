// POST /api/chat — { slug, prompt, sessionId?, dangerous? } (owner only)
// Runs claude headless from the project root and streams the stream-json events as NDJSON.
// With a sessionId, continues the conversation via --resume. dangerous=true auto-approves all tools.
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { inAllow } from '../../../lib/paths.mjs'
import { readRegistry } from '../../../lib/content.mjs'
import { findClaudeRoot, findClaudeBin, RUNS, nextRunId } from '../../../lib/claude.mjs'
import { j, guardOwner } from '../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { slug, prompt, sessionId, dangerous } = await req.json().catch(() => ({}))
  if (!prompt || !String(prompt).trim()) return j({ error: 'The prompt is empty.' }, 400)
  const proj = readRegistry().projects.find((r) => r.slug === slug)
  if (!proj) return j({ error: 'Not a registered project: ' + slug }, 404)
  const root = findClaudeRoot(proj.path) || path.resolve(proj.path)
  if (!inAllow(root)) return j({ error: 'Cannot run outside the allowed folder.' }, 403)

  const args = ['-p', String(prompt), '--output-format', 'stream-json', '--verbose',
    '--permission-mode', dangerous ? 'bypassPermissions' : 'acceptEdits']
  if (sessionId) args.push('--resume', String(sessionId))

  const runId = nextRunId()
  const child = spawn(findClaudeBin(), args, {
    cwd: root,
    env: {
      ...process.env,
      PATH: [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin')].filter(Boolean).join(':'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  RUNS.set(runId, child)

  const encoder = new TextEncoder()
  let stderr = ''
  const stream = new ReadableStream({
    start(controller) {
      const safe = (s) => { try { controller.enqueue(typeof s === 'string' ? encoder.encode(s) : s) } catch {} }
      safe(JSON.stringify({ type: 'moa-run', runId, root }) + '\n')
      child.stdout.on('data', (c) => safe(c))
      child.stderr.on('data', (c) => { stderr += c })
      child.on('error', (e) => {
        RUNS.delete(runId)
        safe('\n' + JSON.stringify({ type: 'moa-error', error: 'Failed to run claude: ' + e.message }) + '\n')
        try { controller.close() } catch {}
      })
      child.on('close', (code) => {
        RUNS.delete(runId)
        if (code !== 0 && stderr.trim())
          safe('\n' + JSON.stringify({ type: 'moa-error', error: stderr.trim().slice(0, 2000) }) + '\n')
        try { controller.close() } catch {}
      })
    },
    cancel() { // if the browser disconnects (tab closed, etc.), stop the run too
      if (RUNS.has(runId)) { RUNS.delete(runId); try { child.kill('SIGTERM') } catch {} }
    },
  })
  // Also cover the case where the request itself is aborted
  req.signal.addEventListener('abort', () => {
    if (RUNS.has(runId)) { RUNS.delete(runId); try { child.kill('SIGTERM') } catch {} }
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}
