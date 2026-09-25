'use client'

import { useCallback, useEffect, useState } from 'react'

export const viewKey = 'hub.reader.view'
export const defaultView = { sidebar: true, outline: true, smallText: false, fullWidth: false }

const readView = () => {
  let stored = null
  try { stored = JSON.parse(localStorage.getItem(viewKey) || 'null') } catch {}
  const view = { ...defaultView }
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(defaultView)) if (typeof stored[key] === 'boolean') view[key] = stored[key]
  }
  return view
}

// How the reader is laid out: which side panels are open and how the document column is set.
// One entry for every project — the way someone likes to read does not change per report.
// The value is read after mount, like the other `hub.*` settings; the layout only renders once
// the project index has loaded, so the stored choice is in place before anything is visible.
export function useReaderView() {
  const [view, setView] = useState(defaultView)
  useEffect(() => { setView(readView()) }, [])
  const toggle = useCallback((key) => setView((current) => {
    const next = { ...current, [key]: !current[key] }
    try { localStorage.setItem(viewKey, JSON.stringify(next)) } catch {}
    return next
  }), [])
  return [view, toggle]
}
