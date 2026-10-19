'use client'

import React, { useEffect, useState } from 'react'
import { Button, Field, Icon, Input, InlineAlert, Spinner } from '../../components/ui/index.jsx'
import AuthLayout from './auth-layout.jsx'
import styles from './auth.module.css'

export default function ResetForm({ token }) {
  const [check, setCheck] = useState(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setCheck(null)
    fetch(`/api/reset-password?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (response.ok && data.ok) return data
        const retryable = response.status === 429 || response.status >= 500
        return {
          error: data.error || (retryable ? 'The reset link could not be checked right now.' : 'Could not verify this reset link.'),
          retryable,
          retryHint: response.status === 429 ? 'Wait a moment, then check again.' : 'Please try again shortly.',
        }
      })
      .then((data) => { if (!controller.signal.aborted) setCheck(data) })
      .catch(() => { if (!controller.signal.aborted) setCheck({ error: 'Could not connect to the server. Please try again shortly.', retryable: true }) })
    return () => controller.abort()
  }, [token, retry])

  // Flag a mismatch once the confirmation stops being the start of the new password.
  const mismatch = confirm !== '' && confirm !== password && !(confirm.length < password.length && password.startsWith(confirm))

  const submit = async (event) => {
    event.preventDefault()
    if (busy || !check?.ok || password.length < 6 || confirm !== password) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(data.error || 'Could not save your new password. Please try again.')
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
    <AuthLayout title="Set a new password." description="Choose a new password for your team account.">
      {!check && <div className={styles.checking} role="status"><Spinner />Checking your reset link…</div>}
      {check?.error && <div className={styles.errorState}><InlineAlert tone="danger" title="Could not verify your reset link">{check.error}</InlineAlert><p className={styles.help}>{check.retryable ? (check.retryHint || 'Check your connection and try again.') : 'If the link has expired or was already used, ask an admin for a new one.'}</p>{check.retryable && <Button onClick={() => setRetry((value) => value + 1)}>Check again</Button>}<Button href="/login" variant="ghost"><Icon name="arrow-left" size={18} />Go to login</Button></div>}
      {check?.ok && <form onSubmit={submit} className={styles.form} aria-label="Reset password" aria-busy={busy || undefined}>
        <div className={styles.invitation}>
          <div className={styles.invitationTitle}><Icon name="shield" size={19} /><span>Reset link verified</span></div>
          <p className={styles.account}><strong>{check.name}</strong><span>{check.email}</span></p>
          <p className={styles.invitationDescription}>Only the password changes — your projects and pinned pages stay as they are. Other devices are logged out.</p>
        </div>
        {/* Lets a password manager file the new password under this account. */}
        <input type="text" name="username" value={check.email} autoComplete="username" readOnly hidden />
        <Field label="New password" hint="Use at least 6 characters."><Input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" autoComplete="new-password" minLength={6} required autoFocus disabled={busy} /></Field>
        <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}><Input name="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Type it again" autoComplete="new-password" minLength={6} required disabled={busy} /></Field>
        {message && <InlineAlert tone="danger">{message}</InlineAlert>}
        <Button type="submit" variant="primary" loading={busy} disabled={password.length < 6 || confirm !== password} className={styles.submit}>Save new password<Icon name="arrow-right" size={18} /></Button>
        <p className={styles.help}>Remembered it? <a href="/login">Log in</a></p>
      </form>}
    </AuthLayout>
  )
}
