'use client'

import React, { useState } from 'react'
import { Button, Dialog, EmptyState, Field, Icon, IconButton, iconNames, InlineAlert, Input, Skeleton, StatusBadge, Textarea } from './ui/index.jsx'
import { Badge, Callout, Checks, DataTable, FooterNote, Issues, Lessons, MediaGrid, Progress, Rules, Stats, Timeline, Updated } from './report/index.jsx'
import styles from './design-system-catalog.module.css'

const imageExample = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="#efefeb"/><rect x="40" y="40" width="400" height="220" rx="12" fill="#fff"/><rect x="80" y="80" width="180" height="12" rx="4" fill="#20211f"/><rect x="80" y="114" width="300" height="8" rx="4" fill="#e2e4dd"/><rect x="80" y="136" width="230" height="8" rx="4" fill="#e2e4dd"/><rect x="80" y="185" width="300" height="14" rx="7" fill="#efefeb"/><rect x="80" y="185" width="190" height="14" rx="7" fill="#b84413"/></svg>')}`
const videoExample = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAARTbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAA350cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAeAAAAEsAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAIAAABAAAAAAL2bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAYABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACoW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAmFzdGJsAAAAwXN0c2QAAAAAAAAAAQAAALFhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAeABLABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAN2F2Y0MBZAAV/+EAGmdkABWs2UHgn+8BEAAAAwAQAAADAYDxYtlgAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABe4AAAAAAAAABhzdHRzAAAAAAAAAAEAAAAYAAAEAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAyGN0dHMAAAAAAAAAFwAAAAEAAAgAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABAAAAAAAgAABAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAABgAAAABAAAAdHN0c3oAAAAAAAAAAAAAABgAAAREAAAAEwAAABAAAAAQAAAAEAAAABkAAAASAAAAEAAAABAAAAAZAAAAEgAAABAAAAAQAAAAGQAAABIAAAAQAAAAEAAAABkAAAASAAAAEAAAABAAAAAZAAAAEgAAABAAAAAUc3RjbwAAAAAAAAABAAAEgwAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjIuMy4xMDAAAAAIZnJlZQAABfZtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTkgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEyIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAABjmWIhAAR//7n4/wKbZW4Nc/ra7lRdGvDq4xCnkF0ZjI/r6gAAAMAAAYdTJECMPnXH4MgAAiSv/sRiBkn/wV0EpefDITrsPdf+ABYt0j+eJqNUKy8qZI5zcEoQBcmzpBJd6HGwSCzDTYGjok/biIhuR1P4BmXzbfcodra7jC8sQALaMeYKWpDanppOH8aUbD/XMimmEx0UFr95t16++mAft1jhZ0PeyilTLlFgSOBrNoCrcz4QA7eR6qdDy0eoRgg4kOoMpsIE/I2d7OkzHs43RsNhUhE8E+CMHJEeW7eAA2fnz8du9MHXdAqEz2rMY1P0ES/c6FvAGEWQ85xY5W0xKJrOHZwUu+8dhrUmnOxeLBFXeFn4Wszu5ffTH2/SFdsaZChWpb6RsUXuOK+GTqJbSGXrFIyi8EdJ4ynFpHtqbBht4v4GWww4w8+8khPXbXpVgasq566grly4BEbHLJAmcMtLALlUvD1ABt1vEXi1oFPUqmB6xRZmoccXdSAeEqlZf/r37NQjGnqk+AAAA25AAAAD0GaJGxBD/6qVQAAAwAHLAAAAAxBnkJ4hv8AAAMAFBEAAAAMAZ5hdEM/AAADABiwAAAADAGeY2pDPwAAAwAYsQAAABVBmmhJqEFomUwIIf/+qlUAAAMABy0AAAAOQZ6GRREsN/8AAAMAFBEAAAAMAZ6ldEM/AAADABixAAAADAGep2pDPwAAAwAYsAAAABVBmqxJqEFsmUwIIf/+qlUAAAMABywAAAAOQZ7KRRUsN/8AAAMAFBEAAAAMAZ7pdEM/AAADABiwAAAADAGe62pDPwAAAwAYsAAAABVBmvBJqEFsmUwIIf/+qlUAAAMABy0AAAAOQZ8ORRUsN/8AAAMAFBEAAAAMAZ8tdEM/AAADABixAAAADAGfL2pDPwAAAwAYsAAAABVBmzRJqEFsmUwIf//+qZYAAAMAG/AAAAAOQZ9SRRUsN/8AAAMAFBEAAAAMAZ9xdEM/AAADABiwAAAADAGfc2pDPwAAAwAYsAAAABVBm3dJqEFsmUwIZ//+nhAAAAMA2YEAAAAOQZ+VRRUsN/8AAAMAFBAAAAAMAZ+2akM/AAADABix'

function Example({ title, description, code, children, wide = false }) {
  return <section className={`${styles.example} ${wide ? styles.wide : ''}`}><div className={styles.exampleHead}><h3>{title}</h3>{description && <p>{description}</p>}</div><div className={styles.preview}>{children}</div>{code && <pre className={styles.code} tabIndex={0} role="region" aria-label={`${title} usage example`}><code>{code}</code></pre>}</section>
}

export default function DesignSystemCatalog() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [exampleEmail, setExampleEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [exampleText, setExampleText] = useState('')
  const [exampleProgress, setExampleProgress] = useState(62)

  const checkEmail = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(exampleEmail)) setEmailError('Enter a valid email address.')
    else { setEmailError(''); setMessage('The example input is valid. Nothing was saved or sent.') }
  }

  return (
    <div className={styles.catalog}>
      <div className={styles.introduction}><StatusBadge tone="accent">MOA design system</StatusBadge><p>Calm screens. Comfortable reading.<br />The foundations and components that shape moa.</p><span>All figures, text, and media below are examples for design review.</span></div>

      <section className={styles.section} aria-labelledby="catalog-foundations">
        <div className={styles.sectionHead}><span>01 · FOUNDATIONS</span><h2 id="catalog-foundations">Color, typography, and icons</h2><p>Name colors by their purpose, use the same tokens across every screen, and draw icons from one set.</p></div>
        <div className={styles.swatches}>
          {[
            ['page', 'Page', 'surface-page'], ['panel', 'Panel', 'surface-panel'], ['subtle', 'Subtle surface', 'surface-subtle'],
            ['ink', 'Body', 'text-primary'], ['muted', 'Muted text', 'text-muted'], ['accent', 'Accent', 'accent-solid'],
          ].map(([tone, label, token]) => <div className={styles.swatch} key={tone}><div className={`${styles.swatchColor} ${styles[`swatch_${tone}`]}`} aria-hidden="true" /><strong>{label}</strong><code>{token}</code></div>)}
        </div>
        <div className={styles.typeBoard}>
          <div><span>Title · 32px</span><p className={styles.typeTitle}>Bring your work together</p></div>
          <div><span>Section heading · 24px</span><p className={styles.typeSection}>Make every story clear</p></div>
          <div><span>Body · 17px / 1.8</span><p className={styles.typeBody}>Give each sentence room to breathe. Type size, line height, and reading width work together so long titles and detailed explanations flow naturally.</p></div>
          <div><span>Caption · 13px</span><p className={styles.typeCaption}>Even small details stay readable with clear contrast.</p></div>
        </div>
        <div className={styles.iconBoard}>
          <div className={styles.iconBoardHead}><span>Icons · Lucide · 1.65px stroke</span><code>{'<Icon name="settings" size={16} />'}</code></div>
          <ul className={styles.icons} aria-label="Icon set">{iconNames.map((name) => <li key={name}><Icon name={name} size={20} /><code>{name}</code></li>)}</ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="catalog-interface">
        <div className={styles.sectionHead}><span>02 · INTERFACE</span><h2 id="catalog-interface">Interface and states</h2><p>From buttons to validation errors, familiar patterns keep the interface consistent.</p></div>
        <div className={styles.examples}>
          <Example title="Button · Actions" description="Make the most important action easy to find." code={'<Button variant="primary">Save</Button>'}>
            <div className={styles.cluster}><Button variant="primary" onClick={() => setMessage('Primary action selected. This is a design review example.')}>Primary action<Icon name="arrow-right" size={17} /></Button><Button onClick={() => setMessage('Secondary action selected.')}>Secondary action</Button><Button variant="ghost" onClick={() => setMessage('Text action selected.')}>Learn more</Button><Button variant="danger" onClick={() => setMessage('This previews a destructive action. Nothing was deleted.')}>Delete example</Button></div>
            <div className={styles.cluster}><Button size="sm">Small button</Button><Button disabled>Unavailable</Button><Button loading>Save</Button><IconButton icon="plus" label="Example icon button" onClick={() => setMessage('Icon buttons also have accessible names.')} /></div>
          </Example>
          <Example title="Badge · Status" description="Communicate status with both color and text." code={'<StatusBadge tone="success">Complete</StatusBadge>'}>
            <div className={styles.cluster}><StatusBadge>Default</StatusBadge><StatusBadge tone="accent">Selected</StatusBadge><StatusBadge tone="success">Complete</StatusBadge><StatusBadge tone="warning">Needs review</StatusBadge><StatusBadge tone="danger">Error</StatusBadge></div>
          </Example>
          <Example title="Field · Input" description="Labels, hints, and errors are associated with their input." code={'<Field label="Email" error={error}>\n  <Input type="email" />\n</Field>'}>
            <div className={styles.fieldStack}><Field label="Example email" hint="This example never sends your input." error={emailError}><Input type="email" placeholder="name@team.com" value={exampleEmail} onChange={(event) => { setExampleEmail(event.target.value); setEmailError('') }} /></Field><Button size="sm" onClick={checkEmail}>Check input</Button><Field label="Disabled input"><Input value="Example disabled state" disabled readOnly /></Field></div>
          </Example>
          <Example title="Textarea · Multiline input" description="Longer notes flow naturally within the input." code={'<Field label="Note"><Textarea rows={4} /></Field>'}>
            <Field label="Example note" hint="Your input stays on this page only."><Textarea rows={4} placeholder="What would you like to note?" value={exampleText} onChange={(event) => setExampleText(event.target.value)} /></Field>
          </Example>
          <Example title="Dialog · Overlay" description="Press Escape to close. Focus returns to the button that opened it." code={'<Dialog open={open} onClose={close} title="Example dialog">\n  ...\n</Dialog>'}>
            <Button onClick={() => setDialogOpen(true)}>Open example dialog<Icon name="openExternal" size={17} /></Button>
          </Example>
          <Example title="Skeleton · Loading" description="Reserve space while content loads.">
            <div className={styles.skeletonPreview} role="status"><span className={styles.srOnly}>Example loading state</span><Skeleton className={styles.skeletonTitle} /><Skeleton className={styles.skeletonLine} /><Skeleton className={styles.skeletonShort} /></div>
          </Example>
          <Example title="InlineAlert · Messages" description="Briefly explain what happened and what to do next." wide>
            <div className={styles.alerts}><InlineAlert title="Information example">Only team members invited to a project can read its documents.</InlineAlert><InlineAlert tone="success" title="Success example">Your changes have been saved.</InlineAlert><InlineAlert tone="warning" title="Review example">Review your input before continuing.</InlineAlert><InlineAlert tone="danger" title="Error example">The connection was interrupted. Try again in a moment.</InlineAlert></div>
          </Example>
          <Example title="EmptyState · No content" description="Explain why the view is empty and offer a next step." wide>
            <EmptyState icon="file-text" title="No documents yet" description="Add your first document to start collecting your work here." action={<Button onClick={() => setMessage('This previews an empty-state action. No document was created.')}><Icon name="plus" size={17} />Add first document</Button>} />
          </Example>
        </div>
        {message && <div className={styles.feedback}><InlineAlert tone="success">{message}</InlineAlert><IconButton icon="x" label="Dismiss example message" onClick={() => setMessage('')} /></div>}
      </section>

      <section className={styles.section} aria-labelledby="catalog-reports">
        <div className={styles.sectionHead}><span>03 · REPORT COMPONENTS</span><h2 id="catalog-reports">Reports made for reading</h2><p>These are the actual shared components, with existing MDX names and data formats preserved.</p></div>
        <Example title="Stats · Key figures" description="label / value / sub / accent" code={'<Stats items={[{ label: "Complete", value: "12", sub: "Example data" }]} />'} wide><Stats items={[{ label: 'Completed documents', value: '12', sub: 'Design review example' }, { label: 'In review', value: '3', sub: 'Documents awaiting review' }, { label: 'Progress', value: '80%', sub: '12 of 15 · example', accent: true }]} /></Example>
        <Example title="DataTable · Comparisons" description="cols / rows / note · Numeric alignment and Total row emphasis" wide><DataTable cols={['Stage', 'Documents', 'Review time (min)', 'Status']} rows={[['Planning', '4', '40', 'Complete'], ['Production', '8', '80', 'In review'], ['Total', '12', '120', 'Example total']]} note="All figures are examples created for component review." /></Example>
        <div className={styles.examples}>
          <Example title="Checks · Checklist" description="items · Prefix with ✅ to mark complete"><Checks items={['✅ Review the first document title and body', '✅ Check the mobile reading width', 'Check horizontal scrolling in wide tables']} /></Example>
          <Example title="Issues · Follow-ups" description="items[].sev · high / warn / done"><Issues items={[{ sev: 'high', t: 'Review document titles', d: 'An example of an item to review first.' }, { sev: 'warn', t: 'Review media captions', d: 'This item needs a review from its owner.' }, { sev: 'done', t: 'Improve input labels', d: 'Resolved items remain readable for context.' }]} /></Example>
        </div>
        <Example title="Timeline · Schedule" description="items[].d / t / accent / now" wide><Timeline items={[{ d: '09.01', t: 'Plan the report structure and reading order' }, { d: '09.07', t: 'Review a representative document in the new design', accent: true, now: true }, { d: '09.10', t: 'Apply team feedback and finish the component guide' }]} /></Example>
        <Example title="Progress · Completion" description="value 0–100 · Pair the number with supporting context." wide><Progress label="Component review example" value={exampleProgress} sub="Use the buttons below to change the progress value." /><div className={styles.cluster}>{[0, 62, 100].map((value) => <Button key={value} size="sm" variant={exampleProgress === value ? 'primary' : 'secondary'} aria-pressed={exampleProgress === value} onClick={() => setExampleProgress(value)}>{value}%</Button>)}</div></Example>
        <Example title="Badge · Document status" description="Existing tone API: live / wait / done / muted" wide><div className={styles.cluster}><Badge tone="live">In progress</Badge><Badge tone="wait">Waiting</Badge><Badge tone="done">Complete</Badge><Badge tone="muted">Archived</Badge></div></Example>
        <Example title="Callout · Highlights" description="type: info / warn / success / danger" wide><div className={styles.callouts}><Callout title="Information">Make key information easy to notice within the flow of a document.</Callout><Callout type="warn" title="Warning">Collect details to check before moving to the next step.</Callout><Callout type="success" title="Ready to continue">Clearly show when everything is ready to proceed.</Callout><Callout type="danger" title="Important issue">An example of an issue that needs to be resolved first.</Callout></div></Example>
        <Example title="Lessons · Reflection" description="keep / fix · t / d for each item, plus fix for an improvement" wide><Lessons keep={[{ t: 'Short, clear sentences', d: 'Readers could quickly find the main point.' }]} fix={[{ t: 'Repeated explanations', d: 'The same explanation appeared in several places.', fix: 'Keep shared guidance in one place.' }]} /></Example>
        <Example title="Rules · Principles" description="items[].no / t / d" wide><Rules items={[{ no: '01', t: 'Start with reading', d: 'Check typography and spacing first.' }, { no: '02', t: 'Use a shared language', d: 'Use design tokens and shared components.' }, { no: '03', t: 'Include small screens', d: 'Let longer content flow naturally.' }]} /></Example>
        <Example title="MediaGrid · Images and video" description="items[].src / cap / video, cols · Reflows on narrow screens" wide><MediaGrid cols={2} items={[{ src: imageExample, cap: 'Example image for design review · not an actual report.' }, { src: videoExample, video: true, cap: 'Example video for design review · 2 seconds, no audio.' }]} /></Example>
        <Example title="Updated · FooterNote" description="Update date and report footnote" wide><Updated at="2026-09-07 · example date" /><FooterNote>This catalog shows the actual components used in the app. All data and media are examples and do not represent results from a real project.</FooterNote></Example>
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Example dialog" description="Open with the button, then press Escape or use Close." footer={<><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => { setDialogOpen(false); setMessage('Example dialog confirmed. No changes were made.') }}>Confirm</Button></>}>
        <div className={styles.dialogExample}><Field label="Example project name" hint="Your input is never saved."><Input placeholder="Our team notes" /></Field><InlineAlert>Keyboard focus stays inside the dialog, then returns to the opening button when it closes.</InlineAlert></div>
      </Dialog>
    </div>
  )
}
