'use client'
// Login — team account (email+password) or owner password (leave email blank).
// Visitors arriving via a share link (/s/…) never pass through here.
import React, { useEffect, useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const m = new URLSearchParams(location.search).get('msg')
    if (m) setMsg(m)
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(email.trim() ? { email: email.trim(), password: pw } : { password: pw }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) setMsg(d.error || `Failed (${r.status})`)
      else {
        const next = new URLSearchParams(location.search).get('next')
        location.href = next && next.startsWith('/') ? next : '/'
        return
      }
    } catch (err) { setMsg(String(err)) }
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit}>
        <div className="hub-brand">MOA</div>
        <h1>MOA</h1>
        <p className="login-sub">Reports on this server are private. Log in with a team account, or use a share link you received.</p>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (leave blank for owner password login)" autoFocus spellCheck={false} autoComplete="email" />
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="Password" spellCheck={false} autoComplete="current-password" />
        <button className="btn accent" disabled={busy || !pw}>{busy ? 'Checking…' : 'Log in'}</button>
        {msg && <div className="login-msg">{msg}</div>}
      </form>
    </div>
  )
}
