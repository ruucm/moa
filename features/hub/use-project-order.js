'use client'
import { useEffect, useRef, useState } from 'react'

// This hook always owns the complete (unfiltered) project list.
export default function useProjectOrder(initial, revision, onError, onSettled) {
  const [list, setList] = useState(initial)
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  useEffect(() => { if (!pending.current) setList(initial) }, [revision])

  const move = async (slug, target) => {
    if (pending.current) return
    const from = list.findIndex((p) => p.slug === slug)
    if (from < 0 || target < 0 || target >= list.length || from === target) return
    const previous = list
    const next = list.slice()
    next.splice(target, 0, next.splice(from, 1)[0])
    pending.current = true
    setSaving(true)
    setList(next)
    try {
      const r = await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slugs: next.map((p) => p.slug) }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || 'Could not save the order.')
    } catch (e) {
      setList(previous)
      onError(e.message || 'Could not save the order. Please try again.')
    } finally {
      pending.current = false
      setSaving(false)
      onSettled?.()
    }
  }
  const dragProps = (p) => ({
    draggable: !saving,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.slug); setDrag(p.slug) },
    onDragEnd: () => { setDrag(null); setOver(null) },
    onDragOver: (e) => { if (!drag || saving) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(p.slug) },
    onDrop: (e) => { e.preventDefault(); if (drag) move(drag, list.findIndex((x) => x.slug === p.slug)); setDrag(null); setOver(null) },
  })
  return { list, saving, move, dragProps, drag, over }
}
