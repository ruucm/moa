'use client'
import React, { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Icon, IconButton } from '../../components/ui/index.jsx'
import EditProjectDialog from './edit-project-dialog.jsx'
import styles from './hub.module.css'

export const projectStatus = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  done: { label: 'Done', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export default function ProjectCard({ project: p, tools, owner, position, total, onMove, reload, onFeedback, reorderEnabled, orderSaving, dragProps = {}, dragging, dropTarget }) {
  const [open, setOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)
  const status = projectStatus[p.status] || projectStatus.active
  const path = p.path || `moa/${p.root || 'projects'}/${p.slug}`
  useEffect(() => {
    if (!open) return
    const focusTarget = menuRef.current?.querySelector('button:not(:disabled)') || menuRef.current
    focusTarget?.focus()
    const away = (e) => { if (!menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  // Menu actions hand focus back to the trigger before opening a dialog, so closing it lands there.
  const focusTrigger = () => triggerRef.current?.querySelector('button')?.focus()
  const remove = async () => {
    setBusy(true)
    try {
      const r = await fetch(p.registered ? '/api/remove' : '/api/hide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p.registered ? { slug: p.slug } : { slug: p.slug, hidden: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || 'Could not save your changes.')
      setConfirmAction(false)
      onFeedback({ tone: 'success', text: `“${p.title}” ${p.registered ? 'was unregistered.' : 'was hidden.'}` })
      reload()
    } catch (e) { onFeedback({ tone: 'danger', text: e.message }) }
    finally { setBusy(false) }
  }
  const move = (direction) => { setOpen(false); focusTrigger(); onMove(p.slug, position + direction) }
  const saved = (details) => {
    setEditing(false)
    onFeedback({ tone: 'success', text: `“${details.title}” was updated.` })
    reload()
  }
  return (
    <div className={[styles.cardWrap, open ? styles.menuOpen : '', dragging ? styles.dragging : '', dropTarget ? styles.dropTarget : ''].join(' ')} role="listitem" {...dragProps}>
      <a className={styles.projectCard} href={`/p/${encodeURIComponent(p.slug)}`} draggable={false}>
        <span className={styles.projectNumber} aria-hidden="true">{String((position ?? 0) + 1).padStart(2, '0')}</span>
        <div className={styles.projectCopy}>
          <h3>{p.title}</h3>
          {p.description && <p className={styles.cardDescription}>{p.description}</p>}
        </div>
        <span className={styles.projectStatus}>{p.status && p.status !== 'active' ? status.label : <span className="sr-only">Active</span>}</span>
        <span className={styles.recordCount}>{p.docs.length}<span>{p.docs.length === 1 ? 'report' : 'reports'}</span></span>
        <span className={styles.cardArrow} aria-hidden="true"><Icon name="arrowUpRight" size={18} /></span>
      </a>
      <>
        <div className={styles.cardMenuTrigger} ref={triggerRef}>
          <IconButton icon="more" label={`${p.title} ${owner ? 'project menu' : 'project details'}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} />
        </div>
        {open && <div className={styles.cardMenu} ref={menuRef} tabIndex={-1} role="group" aria-label={`${p.title} project details`} onKeyDown={(e) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
          const buttons = [...e.currentTarget.querySelectorAll('button:not(:disabled)')]
          if (!buttons.length) return
          const i = buttons.indexOf(document.activeElement)
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          e.preventDefault(); buttons[next]?.focus()
        }}>
          <div className={styles.menuDetails}><span>{status.label}{p.updated ? ` · Updated ${p.updated}` : ''}</span><code>{path}</code>{tools && <span>{tools.skills?.length || 0} skills · {tools.agents?.length || 0} agents</span>}</div>
          {owner && <div className={styles.menuActions}>
            <button onClick={() => { focusTrigger(); setOpen(false); setEditing(true) }}><Icon name="edit" size={16} />Edit details</button>
            <button disabled={!reorderEnabled || position === 0} onClick={() => move(-1)}><Icon name="arrowUp" size={16} />Move earlier</button>
            <button disabled={!reorderEnabled || position === total - 1} onClick={() => move(1)}><Icon name="arrowDown" size={16} />Move later</button>
            {!reorderEnabled && <p className={styles.menuHint}>{orderSaving ? 'Saving project order…' : 'Clear search and filters to change the order.'}</p>}
            <button className={styles.dangerAction} onClick={() => { focusTrigger(); setOpen(false); setConfirmAction(true) }}>{p.registered ? 'Unregister' : 'Hide project'}</button>
          </div>}
        </div>}
        {owner && editing && <EditProjectDialog project={p} onClose={() => setEditing(false)} onSaved={saved} />}
        {owner && <Dialog open={confirmAction} onClose={() => !busy && setConfirmAction(false)} title={p.registered ? 'Unregister this project?' : 'Hide this project?'} description={`“${p.title}”${p.registered ? ' will leave this hub. The original folder and documents stay unchanged.' : ' will be hidden from the hub. You can show it again in Settings.'}`} footer={<><Button variant="secondary" disabled={busy} onClick={() => setConfirmAction(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={remove}>{p.registered ? 'Unregister' : 'Hide'}</Button></>} />}
      </>
    </div>
  )
}
