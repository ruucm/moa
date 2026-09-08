'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Field, Icon, Input } from '../../components/ui/index.jsx'
import { copyText } from '../../lib/client-store.js'
import styles from './reader.module.css'

function LinkAction({ endpoint, payload, label, successLabel, icon, title, getUrl, variant = 'ghost' }) {
  const [state, setState] = useState(null)
  const timer = useRef(null)
  const triggerRef = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const restoreLostFocus = () => requestAnimationFrame(() => {
    if (document.activeElement === document.body) triggerRef.current?.focus({ preventScroll: true })
  })
  const closeManualLink = () => {
    setState(null)
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
  }
  const createLink = async () => {
    clearTimeout(timer.current)
    setState({ busy: true })
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `Could not create the link (${response.status})`)
      const url = `${location.origin}${getUrl(data)}`
      const copied = await copyText(url, { promptFallback: false })
      // The temporary textarea fallback can leave focus on body after removal.
      // Restore only that lost focus; do not interrupt a user who moved elsewhere.
      if (!copied) {
        setState({ manualUrl: url })
        return
      }
      setState({ message: successLabel })
      restoreLostFocus()
    } catch (error) {
      setState({ error: error.message || 'Could not create the link. Please try again.' })
    }
    timer.current = setTimeout(() => setState(null), 5000)
  }
  return (
    <div className={styles.linkAction}>
      <Button ref={triggerRef} variant={variant} size="sm" onClick={createLink} loading={state?.busy} title={title}>
        <Icon name={state?.message ? 'check' : icon} size={16} />
        {state?.message || label}
      </Button>
      {state?.error && <div className={styles.actionError} role="alert">{state.error}</div>}
      <span className={styles.visuallyHidden} role="status">{state?.message}</span>
      <Dialog open={!!state?.manualUrl} onClose={closeManualLink} title="Copy the link manually"
        description="Automatic copy was unavailable. Select and copy the link below."
        footer={<Button onClick={closeManualLink}>Close</Button>}>
        <Field label={label === 'Share' ? 'Document share link' : 'Team invitation link'} hint="Click the field to select the full address.">
          <Input value={state?.manualUrl || ''} readOnly onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} />
        </Field>
      </Dialog>
    </div>
  )
}

export function ShareButton({ slug, doc }) {
  return <LinkAction endpoint="/api/share" payload={{ slug, doc }} label="Share" successLabel="Link copied"
    icon="link" title="Copy a link to this document only" getUrl={(data) => `/s/${data.share.token}`} />
}

export function InviteButton({ slug }) {
  return <LinkAction endpoint="/api/users/invite" payload={{ role: 'member', projects: [slug] }}
    label="Invite teammates" successLabel="Invite link copied" icon="users" variant="secondary"
    title="Copy a single-use invitation to this project, valid for 7 days"
    getUrl={(data) => `/join/${data.token}`} />
}
