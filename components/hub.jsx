'use client'
// Hub dashboard — ported the Hub/Settings/drag-ordering from the old src/main.jsx.
// Data comes from /api/projects instead of import.meta.glob.
import React, { useEffect, useState } from 'react'
import { useIndex, useWatch, copyText } from '../lib/client-store.js'

function useClaudeInfo(enabled) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    if (!enabled) return
    fetch('/api/claude').then((r) => r.json()).then(setInfo).catch(() => {})
  }, [enabled])
  return info || {}
}

// 3×3 dot mark matching the favicon (app/icon.png) — only the center dot gets the accent
const LogoMark = () => (
  <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--ink)" />
    {[8, 16, 24].map((cy) => [8, 16, 24].map((cx) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.1" fill={cx === 16 && cy === 16 ? 'var(--accent)' : '#4A4A46'} />
    )))}
  </svg>
)

const ProjectCard = ({ p, c, cls = '', menu = null, ...rest }) => {
  const card = (
    <a href={`/p/${encodeURIComponent(p.slug)}`} className={'project-card' + cls} {...rest}>
      <div className="head">
        <div className="title">{p.title}</div>
      </div>
      <div className="slug num">{p.path || `moa/${p.root}/${p.slug}`}</div>
      <div className="desc">{p.description || ''}</div>
      <div className="meta">
        <span className="num">{p.docs.length} docs</span>
        {p.updated && <span className="num">updated {p.updated}</span>}
        {c && c.skills.length > 0 && <span className="num">{c.skills.length} skills</span>}
        {c && c.agents.length > 0 && <span className="num">{c.agents.length} agents</span>}
      </div>
    </a>
  )
  // Keep the menu as a sibling outside the card (<a>) — a button inside the link makes clicks swallow each other
  return menu ? <div className="project-card-wrap">{card}{menu}</div> : card
}

// ── Card ⋯ menu (owner only) — unregister / hide. Neither deletes any files ──
function CardMenu({ p, reload }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!e.target.closest?.('.card-menu')) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const post = async (url, body) => {
    setBusy(true)
    const d = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json()).catch((e) => ({ error: String(e) }))
    setBusy(false)
    setOpen(false)
    if (d.error) alert(d.error)
    else reload()
  }

  const unregister = () => {
    if (!confirm(`Unregister "${p.title}"?\nIt only leaves the hub list — the original folder and docs stay put.\n\n${p.path || ''}`)) return
    post('/api/remove', { slug: p.slug })
  }
  const hide = () => {
    if (!confirm(`Hide the "${p.title}" card?\nFiles stay put — it's only hidden from the hub (show it again in ⚙ Settings).`)) return
    post('/api/hide', { slug: p.slug, hidden: true })
  }

  return (
    <div className="card-menu">
      <button className="card-menu-btn" type="button" aria-label={`${p.title} menu`} aria-expanded={open} disabled={busy}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}>⋯</button>
      {open && (
        <div className="card-menu-pop">
          {p.registered ? (
            <>
              <button className="card-menu-item" type="button" disabled={busy} onClick={unregister}>Unregister</button>
              <div className="card-menu-note">Removes it from the hub only — the original folder stays (nothing is deleted).</div>
            </>
          ) : (
            <>
              <button className="card-menu-item" type="button" disabled={busy} onClick={hide}>Hide</button>
              <div className="card-menu-note">Built-in project — files stay put, only the card is hidden.</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Share link management (inside Settings) ──
function ShareList() {
  const [shares, setShares] = useState(null)
  const [msg, setMsg] = useState(null)
  const load = () => fetch('/api/share').then((r) => r.json()).then((d) => setShares(d.shares || [])).catch(() => setShares([]))
  useEffect(() => { load() }, [])
  const copy = async (t) => {
    setMsg((await copyText(`${location.origin}/s/${t}`)) ? 'Link copied' : 'Copy failed — copy it manually')
    setTimeout(() => setMsg(null), 2000)
  }
  const revoke = async (token) => {
    await fetch('/api/share/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    })
    load()
  }
  if (!shares) return null
  if (shares.length === 0) return <div className="settings-msg" style={{ marginTop: 12 }}>No shared doc links yet — create one with "🔗 Share" in a doc's sidebar.</div>
  return (
    <>
      <div className="klabel" style={{ marginTop: 12 }}>Shared doc links</div>
      {msg && <div className="settings-msg">{msg}</div>}
      <div className="settings-list">
        {shares.map((s) => (
          <div key={s.token} className="settings-row">
            <span className="settings-name num">
              {s.slug}/{s.doc} <span className="settings-mdx">{(s.createdAt || '').slice(0, 10)}</span>
            </span>
            <button className="btn" onClick={() => copy(s.token)}>Copy link</button>
            <button className="btn" onClick={() => revoke(s.token)}>Revoke</button>
          </div>
        ))}
      </div>
      <div className="settings-msg">Revoking invalidates the link immediately (only already-granted media access lingers, up to 6 hours).</div>
    </>
  )
}

// ── Team member management (inside Settings) — per-project invite links, access editing, account suspend/delete ──
function MemberList({ index }) {
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState(null)
  const [sel, setSel] = useState(() => new Set()) // projects to include in the invite
  const [editing, setEditing] = useState(null) // account id whose access is being edited
  const load = () => fetch('/api/users').then((r) => r.json()).then(setData).catch(() => setData({ users: [], invites: [] }))
  useEffect(() => { load() }, [])
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 2500) }

  const allProjects = (index.projects || []).filter((p) => !new Set(index.hidden || []).has(p.slug))
  const toggleSel = (slug) =>
    setSel((prev) => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n })

  const invite = async (role) => {
    if (role !== 'admin' && sel.size === 0) return flash('Pick the projects to invite to first (click the chips).')
    const d = await fetch('/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, projects: role === 'admin' ? [] : [...sel] }),
    }).then((r) => r.json())
    if (d.error) return flash(d.error)
    const url = `${location.origin}/join/${d.token}`
    flash((await copyText(url)) ? 'Invite link copied — valid 7 days, single-use' : 'Copy failed — copy it manually')
    load()
  }

  const toggleGrant = async (u, slug) => {
    const cur = new Set(u.projects || [])
    cur.has(slug) ? cur.delete(slug) : cur.add(slug)
    const d = await fetch('/api/users/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, projects: [...cur] }),
    }).then((r) => r.json())
    if (d.error) flash(d.error)
    load()
  }
  const revokeInvite = async (token) => {
    await fetch('/api/users/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove: token }),
    })
    load()
  }
  const update = async (body, okMsg) => {
    const d = await fetch('/api/users/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json())
    flash(d.error || okMsg)
    load()
  }

  if (!data) return null
  const grantChips = (u) => (
    <div className="settings-favs" style={{ margin: '4px 0 8px', flexWrap: 'wrap' }}>
      {allProjects.map((p) => {
        const on = (u.projects || []).includes(p.slug)
        return (
          <button key={p.slug} className={'btn' + (on ? ' accent' : '')} onClick={() => toggleGrant(u, p.slug)}
            title={on ? 'Click to revoke access' : 'Click to grant access'}>{p.title}</button>
        )
      })}
    </div>
  )
  return (
    <>
      <div className="klabel" style={{ marginTop: 12 }}>Team members — per-project invites</div>
      {msg && <div className="settings-msg">{msg}</div>}
      <div className="settings-favs" style={{ flexWrap: 'wrap' }}>
        {allProjects.map((p) => (
          <button key={p.slug} className={'btn' + (sel.has(p.slug) ? ' accent' : '')} onClick={() => toggleSel(p.slug)}>{p.title}</button>
        ))}
      </div>
      <div className="settings-favs">
        <button className="btn accent" onClick={() => invite('member')}>+ Invite member to {sel.size} selected project(s)</button>
        <button className="btn" onClick={() => invite('admin')}>+ Invite admin (all projects)</button>
      </div>
      {data.users.length > 0 && (
        <div className="settings-list">
          {data.users.map((u) => (
            <React.Fragment key={u.id}>
              <div className="settings-row">
                <span className="settings-name num" style={{ opacity: u.disabled ? 0.45 : 1 }}>
                  {u.name} <span className="settings-mdx">
                    {u.email} · {u.role === 'admin' ? 'admin (all projects)' : ((u.projects || []).join(', ') || 'no access')}{u.disabled ? ' · suspended' : ''}
                  </span>
                </span>
                {u.role !== 'admin' && (
                  <button className="btn" onClick={() => setEditing(editing === u.id ? null : u.id)}>{editing === u.id ? 'Close' : 'Edit access'}</button>
                )}
                <button className="btn" onClick={() => update({ id: u.id, disabled: !u.disabled }, u.disabled ? 'Re-enabled' : 'Suspended — access blocked immediately')}>
                  {u.disabled ? 'Enable' : 'Suspend'}
                </button>
                <button className="btn" onClick={() => { if (confirm(`Delete the account for ${u.name} (${u.email})?`)) update({ id: u.id, remove: true }, 'Deleted') }}>Delete</button>
              </div>
              {editing === u.id && grantChips(u)}
            </React.Fragment>
          ))}
        </div>
      )}
      {data.invites.length > 0 && (
        <div className="settings-list">
          {data.invites.map((i) => (
            <div key={i.token} className="settings-row">
              <span className="settings-name num">
                Unused invite <span className="settings-mdx">
                  {i.role === 'admin' ? 'admin (all projects)' : ((i.projects || []).join(', ') || 'no access')} · valid until {new Date(i.exp).toISOString().slice(0, 10)}
                </span>
              </span>
              <button className="btn" onClick={async () => flash((await copyText(`${location.origin}/join/${i.token}`)) ? 'Invite link copied' : 'Copy failed')}>Copy link</button>
              <button className="btn" onClick={() => revokeInvite(i.token)}>Revoke</button>
            </div>
          ))}
        </div>
      )}
      <div className="settings-msg">Members only see the projects they've been invited to. You can also create a single-project invite right from that project's sidebar via "👥 Invite teammate". Suspending blocks access immediately.</div>
    </>
  )
}

// ── Settings: browse folders → register projects ──
// Quick-access starting points for the folder browser. Empty = start at the
// server's browse root (MOA_BROWSE_ROOT, defaults to your home directory).
const FAVORITES = []

// ── Add-project modal — opened from the home screen's "+ Add project" button ──
function AddProjectModal({ onClose, reload }) {
  const [input, setInput] = useState('')
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async (p) => {
    setBusy(true)
    try {
      const d = await fetch('/api/browse?path=' + encodeURIComponent(p)).then((r) => r.json())
      if (d.error) setMsg(d.error)
      else { setData(d); setInput(d.path); setMsg(null) }
    } catch (e) { setMsg(String(e)) }
    setBusy(false)
  }
  useEffect(() => { load('') }, [])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])

  // Keep the modal open after registering — people often add several in a row
  const add = async (target) => {
    setBusy(true)
    const d = await fetch('/api/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: target }),
    }).then((r) => r.json()).catch((e) => ({ error: String(e) }))
    setBusy(false)
    if (d.error) return setMsg(d.error)
    setMsg(`Registered — ${target.split('/').at(-1)}`)
    reload()          // refresh the hub cards behind the modal
    load(input)       // refresh the "registered" badges in the list
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Add project">
        <div className="modal-head">
          <div className="klabel">Add project — pick a folder to register</div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="settings-favs">
          {FAVORITES.map((f) => (
            <button key={f} className="chip num" onClick={() => load(f)}>{f.split('/').at(-1)}</button>
          ))}
        </div>
        <form className="settings-path" onSubmit={(e) => { e.preventDefault(); load(input) }}>
          <input className="num" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
          <button className="btn" disabled={busy}>Go</button>
        </form>
        {msg && <div className="settings-msg">{msg}</div>}
        {data && (
          <div className="settings-list">
            {data.parent && (
              <div className="settings-row">
                <button className="settings-name num" onClick={() => load(data.parent)}>← Parent folder</button>
              </div>
            )}
            {data.dirs.map((d) => (
              <div key={d.path} className="settings-row">
                <button className="settings-name num" onClick={() => load(d.path)} title={d.path}>
                  {d.name}{d.mdxCount > 0 && <span className="settings-mdx"> · mdx {d.mdxCount}</span>}
                </button>
                {d.registered
                  ? <span className="settings-mdx">Registered</span>
                  : <button className="btn accent" disabled={busy} onClick={() => add(d.path)}>+ Add</button>}
              </div>
            ))}
            {data.dirs.length === 0 && <div className="settings-msg">No subfolders here.</div>}
          </div>
        )}
        <div className="settings-msg">
          Registering = a <code>moa/projects/&lt;name&gt;</code> symlink + a <code>registry.json</code> entry. The original folder is never touched.
          Unregister via the card's ⋯ menu or ⚙ Settings.
        </div>
      </div>
    </div>
  )
}

function Settings({ index }) {
  const [tab, setTab] = useState('members') // members | shares | projects
  const [msg, setMsg] = useState(null)

  const post = (url, body, okMsg) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setMsg(d.error)
        else { setMsg(okMsg + ' — reloading shortly…'); setTimeout(() => location.reload(), 900) }
      })

  const remove = (slug) => post('/api/remove', { slug }, `"${slug}" unregistered`)
  const toggleHide = (slug, hide) => post('/api/hide', { slug, hidden: hide }, `"${slug}" ${hide ? 'hidden' : 'shown again'}`)

  const registered = index.registryProjects || []
  const hiddenSet = new Set(index.hidden || [])
  const builtinList = (index.projects || []).filter((p) => !p.registered)
  return (
    <div className="settings card">
      <div className="settings-favs">
        {[['members', 'Team members'], ['shares', 'Share links'], ['projects', 'Projects']].map(([k, label]) => (
          <button key={k} className={'btn' + (tab === k ? ' accent' : '')} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'projects' && <>
      {msg && <div className="settings-msg">{msg}</div>}
      {registered.length > 0 && (
        <>
          <div className="klabel" style={{ marginTop: 20 }}>Registered external projects</div>
          <div className="settings-list">
            {registered.map((r) => (
              <div key={r.slug} className="settings-row">
                <span className="settings-name num" title={r.path}>{r.slug} <span className="settings-mdx">{r.path}</span></span>
                <button className="btn" onClick={() => remove(r.slug)}>Unregister</button>
              </div>
            ))}
          </div>
        </>
      )}
      {builtinList.length > 0 && (
        <>
          <div className="klabel" style={{ marginTop: 20 }}>Built-in projects (folders inside moa)</div>
          <div className="settings-list">
            {builtinList.map((p) => {
              const hid = hiddenSet.has(p.slug)
              return (
                <div key={p.slug} className="settings-row">
                  <span className="settings-name num" style={{ opacity: hid ? 0.45 : 1 }}>
                    {p.title} <span className="settings-mdx">moa/{p.root}/{p.slug}{hid ? ' · hidden' : ''}</span>
                  </span>
                  <button className="btn" onClick={() => toggleHide(p.slug, !hid)}>{hid ? 'Show again' : 'Hide'}</button>
                </div>
              )
            })}
          </div>
        </>
      )}
      <div className="settings-msg">Registering = a <code>moa/projects/&lt;name&gt;</code> symlink + a <code>registry.json</code> entry. The original folder is never touched, and unregistering leaves it as is. Hiding a built-in project doesn't delete files either.</div>
      </>}
      {tab === 'shares' && <ShareList />}
      {tab === 'members' && <MemberList index={index} />}
    </div>
  )
}

// Drag cards to reorder — on drop the order is saved to registry.json via /api/order.
function useCardOrder(initial, depKey) {
  const [list, setList] = useState(initial)
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)
  // initial is a fresh array every render, so only sync when the index refetches (depKey changes)
  useEffect(() => { setList(initial) }, [depKey])

  const drop = () => {
    const from = list.findIndex((p) => p.slug === drag)
    const to = list.findIndex((p) => p.slug === over)
    setDrag(null)
    setOver(null)
    if (from < 0 || to < 0 || from === to) return
    const next = list.slice()
    next.splice(to, 0, next.splice(from, 1)[0])
    setList(next)
    fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs: next.map((p) => p.slug) }),
    }).catch(() => {})
  }

  const props = (p) => {
    const from = drag ? list.findIndex((x) => x.slug === drag) : -1
    const to = list.findIndex((x) => x.slug === p.slug)
    const marked = drag && over === p.slug && drag !== p.slug
    return {
      draggable: true,
      cls: (drag === p.slug ? ' dragging' : '') + (marked ? (from < to ? ' drop-after' : ' drop-before') : ''),
      onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.slug); setDrag(p.slug) },
      onDragEnd: () => { setDrag(null); setOver(null) },
      onDragOver: (e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== p.slug) setOver(p.slug) },
      onDrop: (e) => { e.preventDefault(); drop() },
    }
  }
  return { list, props }
}

export default function Hub() {
  // Legacy hash URL (#/project/doc) compat — forward to path routing
  useEffect(() => {
    const go = () => {
      const m = location.hash.match(/^#\/([^/]+)(?:\/([^/]+))?/)
      if (m) location.replace(`/p/${m[1]}${m[2] ? '/' + m[2] : ''}`)
    }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [])

  const { data: index, error, reload } = useIndex()
  const owner = !!(index && index.owner) // admin — includes legacy owner login
  const authed = owner || !!(index && index.member)
  useWatch(null, authed, reload)
  const claude = useClaudeInfo(owner)
  const [showSettings, setShowSettings] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  useEffect(() => { document.title = 'MOA' }, [])

  const hiddenSet = new Set((index && index.hidden) || [])
  const projectList = ((index && index.projects) || []).filter((p) => !hiddenSet.has(p.slug))
  const demos = projectList.filter((p) => p.demo)
  const { list: real, props: dragProps } = useCardOrder(projectList.filter((p) => !p.demo), index)

  if (error) return <div className="hub"><div className="doc-error"><pre>{error}</pre></div></div>
  if (!index) return <div className="hub"><div className="doc-loading">Loading…</div></div>
  return (
    <div className="hub">
      <div className="hub-head">
        <div className="hub-id">
          <a className="hub-logo" href="/" aria-label="Home — MOA" title="Home"><LogoMark /></a>
          <h1>MOA <span className="hub-tagline">All your project reports in one place</span></h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {owner && <button className="btn accent" onClick={() => setShowAdd(true)}>+ Add project</button>}
          {owner && <button className="btn" onClick={() => setShowSettings((v) => !v)}>{showSettings ? 'Close' : '⚙ Settings'}</button>}
          {authed && (
            <button className="btn" title={index.user ? `Log out ${index.user.name}` : 'Log out'}
              onClick={async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login' }}>
              Log out{index.user ? ` (${index.user.name})` : ''}
            </button>
          )}
        </div>
      </div>
      <div className="hub-sub">
        AI agents write reports to <code>projects/&lt;name&gt;/*.mdx</code> and they show up here in real time.
        Currently {real.length} projects · {real.reduce((n, p) => n + p.docs.length, 0)} docs.
        {owner && ' Drag and drop cards to save their order.'}
      </div>
      {showAdd && owner && <AddProjectModal onClose={() => setShowAdd(false)} reload={reload} />}
      {showSettings && owner && <Settings index={index} />}
      <div className="hub-grid">
        {real.map((p) => (
          <ProjectCard key={p.slug} p={p} c={claude[p.slug]} {...(owner ? dragProps(p) : {})}
            menu={owner ? <CardMenu p={p} reload={reload} /> : null} />
        ))}
      </div>
      {demos.length > 0 && (
        <>
          <div className="hub-section klabel">Demos — demo/projects/ (sample data)</div>
          <div className="hub-grid">
            {demos.map((p) => <ProjectCard key={p.slug} p={p} c={claude[p.slug]} />)}
          </div>
        </>
      )}
    </div>
  )
}
