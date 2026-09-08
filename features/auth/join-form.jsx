'use client'

import React, { useEffect, useState } from 'react'
import { Button, Field, Icon, Input, InlineAlert, Spinner, StatusBadge } from '../../components/ui/index.jsx'
import AuthLayout from './auth-layout.jsx'
import styles from './auth.module.css'

export default function JoinForm({ token }) {
  const [check, setCheck] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setCheck(null)
    fetch(`/api/signup?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (response.ok && data.ok) return data
        const retryable = response.status === 429 || response.status >= 500
        return {
          error: data.error || (retryable ? 'The invitation could not be checked right now.' : 'Could not verify this invitation.'),
          retryable,
          retryHint: response.status === 429 ? 'Wait a moment, then check again.' : 'Please try again shortly.',
        }
      })
      .then((data) => { if (!controller.signal.aborted) setCheck(data) })
      .catch(() => { if (!controller.signal.aborted) setCheck({ error: 'Could not connect to the server. Please try again shortly.', retryable: true }) })
    return () => controller.abort()
  }, [token, retry])

  const submit = async (event) => {
    event.preventDefault()
    if (busy || !check?.ok) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), email: email.trim(), password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(data.error || 'Could not create your account. Check your details and try again.')
        setBusy(false)
        return
      }
      window.location.assign('/')
    } catch {
      setMessage('Could not connect to the server. Please try again shortly.')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Join your team." description="Create an account to explore your team’s work.">
      {!check && <div className={styles.checking} role="status"><Spinner />Checking your invitation…</div>}
      {check?.error && <div className={styles.errorState}><InlineAlert tone="danger" title="Could not verify your invitation">{check.error}</InlineAlert><p className={styles.help}>{check.retryable ? (check.retryHint || 'Check your connection and try again.') : 'If the link has expired or was already used, ask an admin for a new invitation.'}</p>{check.retryable && <Button onClick={() => setRetry((value) => value + 1)}>Check again</Button>}<Button href="/login" variant="ghost"><Icon name="arrow-left" size={18} />Go to login</Button></div>}
      {check?.ok && <form onSubmit={submit} className={styles.form} aria-label="Join team" aria-busy={busy || undefined}>
        <div className={styles.invitation}>
          <div className={styles.invitationTitle}><Icon name="shield" size={19} /><span>Invitation verified</span><StatusBadge tone={check.role === 'admin' ? 'accent' : 'success'}>{check.role === 'admin' ? 'Admin' : 'Team member'}</StatusBadge></div>
          <p className={styles.invitationDescription}>{check.role === 'admin' ? 'You can access all projects and manage the team.' : 'You can view documents in the projects you were invited to.'}</p>
          {check.role !== 'admin' && check.projects?.length > 0 && <ul className={styles.projects}>{check.projects.map((project) => <li key={project}>{project}</li>)}</ul>}
        </div>
        <Field label="Name"><Input name="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" spellCheck={false} required autoFocus disabled={busy} /></Field>
        <Field label="Email"><Input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@team.com" autoComplete="username" spellCheck={false} required disabled={busy} /></Field>
        <Field label="Password" hint="Use at least 6 characters."><Input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" autoComplete="new-password" minLength={6} required disabled={busy} /></Field>
        {message && <InlineAlert tone="danger">{message}</InlineAlert>}
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !email.trim() || password.length < 6} className={styles.submit}>Create account<Icon name="arrow-right" size={18} /></Button>
        <p className={styles.help}>Already have an account? <a href="/login">Log in</a></p>
      </form>}
    </AuthLayout>
  )
}
