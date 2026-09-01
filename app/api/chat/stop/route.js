// POST /api/chat/stop — { runId } stop a run (owner only)
import { RUNS } from '../../../../lib/claude.mjs'
import { j, guardOwner } from '../../../../lib/api.mjs'

export async function POST(req) {
  const denied = guardOwner(req)
  if (denied) return denied
  const { runId } = await req.json().catch(() => ({}))
  const child = RUNS.get(runId)
  if (!child) return j({ error: 'Not running.' }, 404)
  try { child.kill('SIGTERM') } catch {}
  return j({ ok: true })
}
