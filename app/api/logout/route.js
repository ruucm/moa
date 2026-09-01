// POST /api/logout — clear owner and team account cookies
export async function POST() {
  const kill = (name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  const headers = new Headers({ 'Content-Type': 'application/json' })
  headers.append('Set-Cookie', kill('moa_owner'))
  headers.append('Set-Cookie', kill('moa_user'))
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
}
