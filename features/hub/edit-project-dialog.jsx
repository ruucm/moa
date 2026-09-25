'use client'
import React, { useId, useRef, useState } from 'react'
import { Button, Dialog, Field, InlineAlert, Input } from '../../components/ui/index.jsx'
import styles from './hub.module.css'

const oneLine = (text) => text.replace(/\s+/g, ' ').trim()

// Edits what the hub shows for a project. A registered project keeps the change in the hub's
// registry, so the connected folder stays untouched; a local project writes it to its _meta.json.
export default function EditProjectDialog({ project, onClose, onSaved }) {
  const [title, setTitle] = useState(project.title || '')
  const [description, setDescription] = useState(project.description || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const formId = useId()
  const titleRef = useRef(null)
  const cleanTitle = oneLine(title)

  const submit = async (event) => {
    event.preventDefault()
    if (!cleanTitle || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/projects/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: project.slug, title: cleanTitle, description: oneLine(description) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) throw new Error(data.error || 'Could not save the project details.')
      onSaved(data.project)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return <Dialog open onClose={() => { if (!busy) onClose() }} title="Edit project details" initialFocus={titleRef}
    description="The title and description shown for this project. Its documents stay as they are."
    footer={<>
      <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form={formId} loading={busy} disabled={!cleanTitle}>Save</Button>
    </>}>
    <form id={formId} className={styles.editForm} onSubmit={submit}>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <Field label="Title" error={cleanTitle ? undefined : 'A title is required.'}>
        <Input ref={titleRef} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <Field label="Description" hint="One line under the title. Leave it empty to show none.">
        <Input value={description} maxLength={300} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <p className={styles.editHelp}>{project.registered ? 'Saved in this hub only. The connected folder is not changed.' : 'Saved to the project’s _meta.json.'}</p>
    </form>
  </Dialog>
}
