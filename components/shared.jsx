'use client'
// Shared report components for the hub — usable in MDX without imports (injected globally via MDXProvider).
// Carries over an established components API: Updated, Stats, DataTable, Issues,
// Lessons, Rules, Timeline, Checks, FooterNote, etc. New additions: Callout, Progress, Badge, MediaGrid.
import React from 'react'

const INK = '#161616', BODY = '#52524E', GRAY = '#8A8A82', ACCENT = '#E8500A'

export const Updated = ({ at }) => <div className="updated">Last updated: {at}</div>

// Wraps markdown tables (`| a | b |`) in a horizontal scroll container — keeps narrow screens from being pushed sideways.
// Injected into MDXProvider under the `table` key, so it applies automatically to every table in MDX.
export const table = ({ children, ...rest }) => (
  <div className="table-wrap"><table {...rest}>{children}</table></div>
)

export const Stats = ({ items }) => (
  <div className="stats">
    {items.map((s, i) => (
      <div key={i} className={'stat' + (s.accent ? ' accent' : '')}>
        <div className="label">{s.label}</div>
        <div className="value num">{s.value}</div>
        {s.sub && <div className="sub">{s.sub}</div>}
      </div>
    ))}
  </div>
)

// Measured-data table — first column is the label; rows whose first cell is 'Total' (or '누적') are emphasized
export const DataTable = ({ cols, rows, note }) => (
  <>
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const total = r[0] === 'Total' || r[0] === '누적'
            return (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className="num" style={{
                    color: j === 0 || total ? INK : BODY,
                    fontWeight: j === 0 || total ? 700 : 400,
                    borderTop: total ? '1.5px solid ' + INK : undefined,
                  }}>{v}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    {note && <p style={{ fontSize: 13 }}>{note}</p>}
  </>
)

const SEV = { high: ['Urgent', ACCENT], warn: ['Watch', GRAY], done: ['Fixed', '#1a7f37'] }

export const Issues = ({ items }) => (
  <div className="card">
    {items.map((it, i) => {
      const [tag, color] = SEV[it.sev] || SEV.warn
      return (
        <div key={i} className="row">
          <div style={{ width: 46, flexShrink: 0, fontSize: 11.5, fontWeight: 700, color }}>{tag}</div>
          <div style={{ fontSize: 13.5 }}>
            <b style={{ fontSize: 14, textDecoration: it.sev === 'done' ? 'line-through' : 'none', color: it.sev === 'done' ? GRAY : INK }}>{it.t}</b>{' '}
            <span style={{ color: BODY }}>{it.d}</span>
          </div>
        </div>
      )
    })}
  </div>
)

export const Lessons = ({ keep, fix }) => (
  <div className="grid2">
    <div className="card">
      <div className="klabel" style={{ marginBottom: 8 }}>What worked → keep as is</div>
      {keep.map((l, i) => (
        <div key={i} className="row" style={{ display: 'block' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{l.t}</div>
          <div style={{ fontSize: 13, color: BODY }}>{l.d}</div>
        </div>
      ))}
    </div>
    <div className="card">
      <div className="klabel" style={{ marginBottom: 8 }}>What failed → block</div>
      {fix.map((l, i) => (
        <div key={i} className="row" style={{ display: 'block' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{l.t}</div>
          <div style={{ fontSize: 13, color: BODY }}>{l.d}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>→ {l.fix}</div>
        </div>
      ))}
    </div>
  </div>
)

export const Rules = ({ items }) => (
  <div className="grid3">
    {items.map((r) => (
      <div key={r.no} className="card">
        <div className="num" style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>{r.no}</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{r.t}</div>
        <div style={{ fontSize: 13, color: BODY, marginTop: 8 }}>{r.d}</div>
      </div>
    ))}
  </div>
)

export const Timeline = ({ items }) => (
  <div className="card">
    {items.map((t, i) => (
      <div key={i} className="row">
        <div className="num" style={{ width: 92, flexShrink: 0, fontSize: 13, fontWeight: 700, color: t.accent ? ACCENT : INK }}>{t.d}</div>
        <div style={{ fontSize: 14, color: t.accent ? INK : BODY, fontWeight: t.accent ? 600 : 400 }}>
          {t.t}{t.now && <span className="pill">Today</span>}
        </div>
      </div>
    ))}
  </div>
)

export const Checks = ({ items }) => (
  <div className="card">
    {items.map((c, i) => {
      const done = c.startsWith('✅')
      return (
        <div key={i} className={'check' + (done ? ' done' : '')}>
          <div className="box" />
          <div className="txt">{c.replace('✅ ', '')}</div>
        </div>
      )
    })}
  </div>
)

export const FooterNote = ({ children }) => <div className="footer-note">{children}</div>

// ── New components ──

// Callout box — type: info | warn | success | danger
export const Callout = ({ type = 'info', title, children }) => (
  <div className={'callout ' + type}>
    {title && <div className="callout-title">{title}</div>}
    <div className="callout-body">{children}</div>
  </div>
)

// Progress bar — value 0–100
export const Progress = ({ label, value, sub }) => (
  <div className="progress">
    <div className="progress-head">
      <span className="progress-label">{label}</span>
      <span className="num progress-pct">{value}%</span>
    </div>
    <div className="progress-track"><div className="progress-fill" style={{ width: Math.min(100, Math.max(0, value)) + '%' }} /></div>
    {sub && <div className="progress-sub">{sub}</div>}
  </div>
)

// Status badge — tone: live | wait | done | muted
export const Badge = ({ tone = 'muted', children }) => (
  <span className={'badge ' + tone}>{children}</span>
)

// Image/video grid — items: [{ src, cap, video? }]
export const MediaGrid = ({ items, cols = 3 }) => (
  <div className="media-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
    {items.map((m, i) => (
      <figure key={i}>
        {m.video
          ? <video controls src={m.src} />
          : <img src={m.src} alt={m.cap || ''} loading="lazy" />}
        {m.cap && <figcaption>{m.cap}</figcaption>}
      </figure>
    ))}
  </div>
)
