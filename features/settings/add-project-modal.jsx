'use client'
import React, { useEffect, useState } from 'react'
import { Button, Dialog, EmptyState, Field, Icon, InlineAlert, Input, StatusBadge } from '../../components/ui/index.jsx'
import { requestJSON } from './settings-panel.jsx'
import styles from './settings.module.css'

export default function AddProjectModal({ onClose, reload }) {
  // An empty path lets the server select MOA_BROWSE_ROOT (home by default).
  const [path, setPath] = useState('')
  const [data, setData] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = async (target, keepMessage = false) => {
    setBusy(true)
    if (!keepMessage) setMessage(null)
    try { const d = await requestJSON(`/api/browse?path=${encodeURIComponent(target)}`); setData(d); setPath(d.path) }
    catch (e) { setMessage({ tone: 'danger', text: e.message }) }
    finally { setBusy(false) }
  }
  useEffect(() => { load('') }, [])
  const add = async (target) => {
    setBusy(true)
    try {
      await requestJSON('/api/add', { path: target })
      setMessage({ tone: 'success', text: `“${target.split('/').at(-1)}” is connected. You can keep adding folders.` })
      reload()
      await load(data?.path || path, true)
    } catch (e) { setMessage({ tone: 'danger', text: e.message }) }
    finally { setBusy(false) }
  }
  return <Dialog open onClose={onClose} title="Add project" description="Choose a folder of reports to connect to MOA." size="lg" footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
    <div className={styles.stack}>
      <form onSubmit={(e) => { e.preventDefault(); load(path) }} className={styles.pathForm}>
        <Field label="Folder path"><Input value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} /></Field><Button variant="secondary" loading={busy} type="submit">Go</Button>
      </form>
      {message && <InlineAlert tone={message.tone}>{message.text}</InlineAlert>}
      {!data && busy && <div className={styles.loading} role="status">Loading folders…</div>}
      {data && <div className={styles.directoryList} aria-busy={busy}>
        {data.parent && <button className={styles.parentFolder} disabled={busy} onClick={() => load(data.parent)}><Icon name="arrowLeft" size={17} />Parent folder</button>}
        {data.dirs.map((d) => <div className={styles.directoryRow} key={d.path}>
          <button className={styles.directoryName} title={d.path} disabled={busy} onClick={() => load(d.path)}><span className={styles.rowIcon}><Icon name="folder" size={20} /></span><span><strong>{d.name}</strong><small>{d.mdxCount > 0 ? `${d.mdxCount} ${d.mdxCount === 1 ? 'document' : 'documents'}` : 'Open folder'}</small></span><Icon name="arrowRight" size={15} /></button>
          {d.registered ? <StatusBadge tone="success">Connected</StatusBadge> : <Button size="sm" variant="secondary" disabled={busy} onClick={() => add(d.path)}><Icon name="plus" size={15} />Add</Button>}
        </div>)}
        {data.dirs.length === 0 && <EmptyState icon="folder" title="No subfolders" description="Go to the parent folder or enter another path." />}
      </div>}
      <p className={styles.help}>Original folders and documents stay unchanged. Disconnect a project from its menu or Settings.</p>
    </div>
  </Dialog>
}
