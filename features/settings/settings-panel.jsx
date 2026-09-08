'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog, EmptyState, Icon, InlineAlert, Input, StatusBadge } from '../../components/ui/index.jsx'
import { copyText } from '../../lib/client-store.js'
import styles from './settings.module.css'

export async function requestJSON(url, body) {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) throw new Error(d.error || 'Could not complete the request. Please try again.')
  return d
}

function Feedback({ message }) {
  return message ? <InlineAlert tone={message.tone || 'success'}>{message.text}</InlineAlert> : null
}

function ProjectPicker({ projects, selected, onToggle, disabled, label = 'Accessible projects' }) {
  const [query, setQuery] = useState('')
  const visible = projects.filter((p) => p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <fieldset className={styles.picker} disabled={disabled}>
    <legend>{label}<span>{selected.length} selected</span></legend>
    {projects.length > 5 && <Input type="search" aria-label="Search accessible projects" value={query} placeholder="Find a project" onChange={(e) => setQuery(e.target.value)} />}
    <div className={styles.projectChoices}>
      {visible.map((p) => <label key={p.slug} className={styles.projectChoice}><input type="checkbox" checked={selected.includes(p.slug)} onChange={() => onToggle(p.slug)} /><span>{p.title}</span></label>)}
      {visible.length === 0 && <p className={styles.help}>No projects to select.</p>}
    </div>
  </fieldset>
}

function Members({ index }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [message, setMessage] = useState(null)
  const [selected, setSelected] = useState([])
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const confirmationRef = useRef(null)
  useEffect(() => { if (confirmation) { confirmationRef.current?.scrollIntoView({ block: 'nearest' }); confirmationRef.current?.focus() } }, [confirmation])
  const projects = (index.projects || []).filter((p) => !(index.hidden || []).includes(p.slug))
  const names = (slugs) => (slugs || []).map((slug) => projects.find((p) => p.slug === slug)?.title || slug).join(', ') || 'No project access'
  const load = useCallback(async () => {
    try { setLoadError(null); setData(await requestJSON('/api/users')) }
    catch (e) { setLoadError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const run = async (action, text) => {
    if (busy) return
    setBusy(true); setMessage(null)
    try { await action(); if (text) setMessage({ text }); setConfirmation(null); await load() }
    catch (e) { setMessage({ tone: 'danger', text: e.message }) }
    finally { setBusy(false) }
  }
  const invite = (role) => run(async () => {
    const d = await requestJSON('/api/users/invite', { role, projects: role === 'admin' ? [] : selected })
    const copied = await copyText(`${location.origin}/join/${d.token}`)
    setMessage({ tone: copied ? 'success' : 'warning', text: copied ? 'Invitation link copied. It can be used once within 7 days.' : 'Invitation created. Copy the displayed URL manually.' })
  })
  const grant = async (u, slug) => {
    if (busy) return
    const previousProjects = [...(u.projects || [])]
    const nextProjects = previousProjects.includes(slug)
      ? previousProjects.filter((project) => project !== slug)
      : [...previousProjects, slug]
    const showProjects = (projects) => setData((previous) => ({
      ...previous,
      users: previous.users.map((user) => user.id === u.id ? { ...user, projects } : user),
    }))
    // Keep the controlled checkbox in step with the user's click while saving.
    showProjects(nextProjects)
    setBusy(true)
    setMessage(null)
    try {
      await requestJSON('/api/users/update', { id: u.id, projects: nextProjects })
      setMessage({ text: 'Project access saved.' })
      await load()
    } catch (e) {
      showProjects(previousProjects)
      setMessage({ tone: 'danger', text: e.message })
    } finally {
      setBusy(false)
    }
  }
  if (loadError && !data) return <EmptyState icon="users" title="Could not load team members" description={loadError} action={<Button onClick={load}>Try again</Button>} />
  if (!data) return <div className={styles.loading} role="status">Loading team members…</div>
  return <div className={styles.stack}>
    <Feedback message={message} />
    {loadError && <InlineAlert tone="danger">{loadError}</InlineAlert>}
    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><h3>Invite your team</h3><p>Choose projects and send an invitation link.</p></div><Icon name="users" size={22} /></div>
      <ProjectPicker projects={projects} selected={selected} disabled={busy} onToggle={(slug) => setSelected((prev) => prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug])} />
      <div className={styles.actions}><Button variant="primary" disabled={busy || selected.length === 0} onClick={() => invite('member')}><Icon name="link" size={17} />Create invitation link{selected.length > 0 ? ` · ${selected.length} ${selected.length === 1 ? 'project' : 'projects'}` : ''}</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmation({ title: 'Invite an admin?', description: 'Admins can access all projects and manage members, shared links, and projects.', action: () => invite('admin'), label: 'Create admin invitation link' })}>Invite admin</Button></div>
    </section>
    {confirmation && <div className={styles.confirmation} ref={confirmationRef} tabIndex={-1}><strong>{confirmation.title}</strong><p>{confirmation.description}</p><div className={styles.actions}><Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button variant="danger" loading={busy} onClick={confirmation.action}>{confirmation.label}</Button></div></div>}
    <section className={styles.section}>
      <div className={styles.sectionHeading}><h3>Team members <span>{data.users.length}</span></h3></div>
      {data.users.length === 0 ? <p className={styles.help}>No team members yet. Invite your first teammate.</p> : <div className={styles.list}>{data.users.map((u) => <div key={u.id} className={styles.memberItem}>
        <div className={styles.row}>
          <span className={styles.avatar}>{(u.name || '?').slice(0, 1)}</span>
          <div className={styles.rowText}><div className={styles.nameLine}><strong>{u.name}</strong><StatusBadge tone={u.disabled ? 'warning' : 'neutral'}>{u.disabled ? 'Disabled' : u.role === 'admin' ? 'Admin' : 'Member'}</StatusBadge></div><span>{u.email}</span></div>
          <div className={styles.rowActions}>{u.role !== 'admin' && <Button variant="secondary" size="sm" disabled={busy} aria-expanded={editing === u.id} onClick={() => setEditing(editing === u.id ? null : u.id)}>{editing === u.id ? 'Close access' : 'Edit access'}</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmation({ title: u.disabled ? 'Reactivate this account?' : 'Disable this account?', description: `${u.name} will ${u.disabled ? 'regain access to their projects.' : 'lose access to their projects immediately.'}`, label: u.disabled ? 'Reactivate' : 'Disable', action: () => run(() => requestJSON('/api/users/update', { id: u.id, disabled: !u.disabled }), u.disabled ? 'Account reactivated.' : 'Account disabled.') })}>{u.disabled ? 'Reactivate' : 'Disable'}</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmation({ title: 'Delete this team member?', description: `${u.name} (${u.email}) will be deleted and will lose access to their projects.`, label: 'Delete account', action: () => run(() => requestJSON('/api/users/update', { id: u.id, remove: true }), 'Account deleted.') })}>Delete</Button></div>
        </div>
        <p className={styles.accessSummary}>{u.role === 'admin' ? 'Access to all projects.' : names(u.projects)}</p>
        {editing === u.id && <ProjectPicker projects={projects} selected={u.projects || []} onToggle={(slug) => grant(u, slug)} disabled={busy} />}
      </div>)}</div>}
    </section>
    {data.invites.length > 0 && <section className={styles.section}><div className={styles.sectionHeading}><h3>Pending invitations <span>{data.invites.length}</span></h3></div><div className={styles.list}>{data.invites.map((i) => <div className={styles.row} key={i.token}><div className={styles.rowText}><strong>{i.role === 'admin' ? 'Invite admin' : names(i.projects)}</strong><span>Expires {new Date(i.exp).toLocaleDateString('en-US')} · Single use</span></div><div className={styles.rowActions}><Button variant="secondary" size="sm" onClick={async () => setMessage({ text: (await copyText(`${location.origin}/join/${i.token}`)) ? 'Invitation link copied.' : 'Copy the displayed URL manually.' })}>Copy link</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => requestJSON('/api/users/invite', { remove: i.token }), 'Invitation revoked.')}>Revoke</Button></div></div>)}</div></section>}
  </div>
}

function Shares({ index }) {
  const [shares, setShares] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(null)
  const load = useCallback(async () => { try { setError(null); setShares((await requestJSON('/api/share')).shares || []) } catch (e) { setError(e.message) } }, [])
  useEffect(() => { load() }, [load])
  const revoke = async (token) => { setBusy(token); try { await requestJSON('/api/share/remove', { token }); setMessage({ text: 'Share link revoked.' }); await load() } catch (e) { setMessage({ tone: 'danger', text: e.message }) } finally { setBusy(null) } }
  return <div className={styles.stack}>
    <Feedback message={message} />
    <div className={styles.sectionHeading}><div><h3>Shared documents</h3><p>Anyone with a link can view only that document.</p></div><Icon name="link" size={22} /></div>
    {error && <InlineAlert tone="danger">{error}<Button variant="ghost" size="sm" onClick={load}>Try again</Button></InlineAlert>}
    {!shares && !error && <div className={styles.loading} role="status">Loading shared links…</div>}
    {shares?.length === 0 && <EmptyState icon="link" title="No shared documents" description="Use Share on a document to create a link." />}
    {shares?.length > 0 && <><div className={styles.list}>{shares.map((s) => { const p = (index.projects || []).find((p) => p.slug === s.slug); const doc = p?.docs.find((d) => d.slug === s.doc); return <div className={styles.row} key={s.token}><span className={styles.rowIcon}><Icon name="file" size={20} /></span><div className={styles.rowText}><strong>{doc?.title || s.doc}</strong><span>{p?.title || s.slug} · {(s.createdAt || '').slice(0, 10)}</span></div><div className={styles.rowActions}><Button variant="secondary" size="sm" onClick={async () => setMessage({ text: (await copyText(`${location.origin}/s/${s.token}`)) ? 'Share link copied.' : 'Copy the displayed URL manually.' })}>Copy link</Button><Button variant="ghost" size="sm" disabled={!!busy} loading={busy === s.token} onClick={() => revoke(s.token)}>Revoke</Button></div></div>})}</div><p className={styles.help}>Revoked links stop working immediately. Existing media access expires within 6 hours.</p></>}
  </div>
}

function Projects({ index, reload }) {
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(null)
  const [remove, setRemove] = useState(null)
  const confirmationRef = useRef(null)
  useEffect(() => { if (remove) { confirmationRef.current?.scrollIntoView({ block: 'nearest' }); confirmationRef.current?.focus() } }, [remove])
  const hidden = new Set(index.hidden || [])
  const builtin = (index.projects || []).filter((p) => !p.registered)
  const external = index.registryProjects || []
  const change = async (url, body, text) => { setBusy(body.slug); try { await requestJSON(url, body); setMessage({ text }); setRemove(null); reload() } catch (e) { setMessage({ tone: 'danger', text: e.message }) } finally { setBusy(null) } }
  return <div className={styles.stack}>
    <Feedback message={message} />
    {remove && <div className={styles.confirmation} ref={confirmationRef} tabIndex={-1}><strong>Unregister “{remove.title || remove.slug}”?</strong><p>This removes the connection from the hub. The original folder and documents stay unchanged.</p><div className={styles.actions}><Button variant="secondary" onClick={() => setRemove(null)} disabled={!!busy}>Cancel</Button><Button variant="danger" loading={!!busy} onClick={() => change('/api/remove', { slug: remove.slug }, 'Project unregistered.')}>Unregister</Button></div></div>}
    <section className={styles.section}><div className={styles.sectionHeading}><div><h3>Connected projects <span>{external.length}</span></h3><p>Reports from external folders, together in MOA.</p></div></div>{external.length === 0 ? <p className={styles.help}>No external projects connected yet.</p> : <div className={styles.list}>{external.map((p) => <div className={styles.row} key={p.slug}><span className={styles.rowIcon}><Icon name="folder" size={20} /></span><div className={styles.rowText}><strong>{p.title || (index.projects || []).find((item) => item.slug === p.slug)?.title || p.slug}</strong><code>{p.path}</code></div><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setRemove(p)}>Unregister</Button></div>)}</div>}</section>
    <section className={styles.section}><div className={styles.sectionHeading}><div><h3>Local projects <span>{builtin.length}</span></h3><p>Show hidden projects again from here.</p></div></div><div className={styles.list}>{builtin.map((p) => <div className={styles.row} key={p.slug}><span className={styles.rowIcon}><Icon name="folder" size={20} /></span><div className={styles.rowText}><div className={styles.nameLine}><strong>{p.title}</strong>{hidden.has(p.slug) && <StatusBadge tone="neutral">Hidden</StatusBadge>}{p.demo && <StatusBadge tone="neutral">Demo</StatusBadge>}</div><code>moa/{p.root}/{p.slug}</code></div><Button variant="secondary" size="sm" disabled={!!busy} loading={busy === p.slug} onClick={() => change('/api/hide', { slug: p.slug, hidden: !hidden.has(p.slug) }, hidden.has(p.slug) ? 'Project is visible again.' : 'Project hidden.')}>{hidden.has(p.slug) ? 'Show again' : 'Hide'}</Button></div>)}</div></section>
  </div>
}

export default function SettingsPanel({ index, onClose, reload }) {
  const [tab, setTab] = useState('projects')
  const tabs = [['projects', 'Projects', 'folder'], ['members', 'Team members', 'users'], ['shares', 'Shared links', 'link']]
  return <Dialog open onClose={onClose} title="Settings" description="Manage projects, people, and shared links." size="lg">
    <div className={styles.tabs} role="tablist" aria-label="Settings categories">{tabs.map(([id, name, icon]) => <button key={id} id={`settings-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`settings-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(e) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const current = tabs.findIndex(([key]) => key === tab); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; setTab(tabs[next][0]); document.getElementById(`settings-tab-${tabs[next][0]}`)?.focus() }}><Icon name={icon} size={17} />{name}</button>)}</div>
    <div className={styles.tabPanel} role="tabpanel" tabIndex={0} id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
      {tab === 'projects' && <Projects index={index} reload={reload} />}
      {tab === 'members' && <Members index={index} />}
      {tab === 'shares' && <Shares index={index} />}
    </div>
  </Dialog>
}
