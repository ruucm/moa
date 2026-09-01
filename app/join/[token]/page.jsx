'use client'
// Invite-link signup — /join/<token>. If the token is valid, collects name/email/password, creates the account, and logs in immediately.
import React, { use, useEffect, useState } from 'react'

export default function JoinPage({ params }) {
  const { token } = use(params)
  const [check, setCheck] = useState(null) // null=checking | {ok} | {error}
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/signup?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setCheck)
      .catch((e) => setCheck({ error: String(e) }))
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, email, password: pw }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(d.error || `Failed (${r.status})`); setBusy(false); return }
      location.href = '/'
    } catch (err) { setMsg(String(err)); setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit}>
        <div className="hub-brand">MOA</div>
        <h1>Join the team</h1>
        {!check && <p className="login-sub">Checking invite link…</p>}
        {check && check.error && <div className="login-msg">{check.error}</div>}
        {check && check.ok && (
          <>
            <p className="login-sub">
              You've been invited{check.role === 'admin' ? ' (admin — all projects)' : ''}.
              {check.role !== 'admin' && check.projects && check.projects.length > 0 && (
                <> Projects you'll have access to: <b>{check.projects.join(', ')}</b>.</>
              )} Create an account to start viewing right away.
            </p>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name" autoFocus spellCheck={false} autoComplete="name" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Email" spellCheck={false} autoComplete="email" />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="Password (min 6 characters)" spellCheck={false} autoComplete="new-password" />
            <button className="btn accent" disabled={busy || !name || !email || pw.length < 6}>
              {busy ? 'Creating…' : 'Sign up and start'}
            </button>
            {msg && <div className="login-msg">{msg}</div>}
          </>
        )}
      </form>
    </div>
  )
}
