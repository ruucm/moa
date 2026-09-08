'use client'

import React, { useEffect, useState } from 'react'
import { Button, Field, Icon, Input, InlineAlert } from '../../components/ui/index.jsx'
import AuthLayout from './auth-layout.jsx'
import styles from './auth.module.css'

export default function LoginForm() {
  const [mode, setMode] = useState('team')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const notice = new URLSearchParams(window.location.search).get('msg')
    if (notice) setMessage(notice)
  }, [])

  const changeMode = (nextMode) => {
    setMode(nextMode)
    setMessage(null)
    setPassword('')
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'team' ? { email: email.trim(), password } : { password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(data.error || 'Could not log in. Check your details and try again.')
        setBusy(false)
        return
      }
      const next = new URLSearchParams(window.location.search).get('next')
      // Return only to this MOA origin, including direct document links.
      let destination = '/'
      if (next?.startsWith('/')) {
        const url = new URL(next, window.location.origin)
        if (url.origin === window.location.origin) destination = `${url.pathname}${url.search}${url.hash}`
      }
      window.location.assign(destination)
    } catch {
      setMessage('Could not connect to the server. Please try again shortly.')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Welcome back." description="Bring your reports together and pick up where you left off.">
      <form onSubmit={submit} className={styles.form} aria-label="Log in" aria-busy={busy || undefined}>
        <fieldset className={styles.modeSelector} disabled={busy}>
          <legend className={styles.srOnly}>Login method</legend>
          {[['team', 'Team account'], ['owner', 'Owner password']].map(([value, label]) => (
            <label key={value} className={styles.modeOption}>
              <input className={styles.modeInput} type="radio" name="login-mode" value={value} checked={mode === value} onChange={() => changeMode(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <p className={styles.modeDescription}>{mode === 'team' ? 'Log in with the team account you created from an invitation.' : 'Log in with the owner password configured for this server.'}</p>
        {mode === 'team' && <Field label="Email"><Input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@team.com" autoComplete="username" spellCheck={false} required autoFocus disabled={busy} /></Field>}
        <Field label={mode === 'team' ? 'Password' : 'Owner password'}>
          <Input key={mode} name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required disabled={busy} />
        </Field>
        {message && <InlineAlert tone="danger">{message}</InlineAlert>}
        <Button type="submit" variant="primary" loading={busy} disabled={!password || (mode === 'team' && !email.trim())} className={styles.submit}>Log in<Icon name="arrow-right" size={18} /></Button>
        <p className={styles.help}>Open shared documents directly from their links.<br />Need a team account? Ask an admin for an invitation.</p>
      </form>
    </AuthLayout>
  )
}
