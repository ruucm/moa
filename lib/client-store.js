'use client'
// 클라이언트 공용 — 프로젝트 인덱스(/api/projects) 캐시 + 변경 감시(SSE) 훅.
import { useEffect, useRef, useState, useCallback } from 'react'

let indexPromise = null
export const fetchIndex = (force) => {
  if (force || !indexPromise)
    indexPromise = fetch('/api/projects').then(async (r) => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      return d
    })
  return indexPromise
}

export function useIndex() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const reload = useCallback(() => {
    fetchIndex(true).then((next) => { setData(next); setError(null) }).catch((e) => setError(String(e.message || e)))
  }, [])
  useEffect(() => {
    fetchIndex().then(setData).catch((e) => setError(String(e.message || e)))
  }, [])
  return { data, error, reload }
}

// 클립보드 복사 — navigator.clipboard 는 HTTPS·localhost 에서만 있다.
// 공인 IP http 접속(비보안 컨텍스트)에선 textarea+execCommand 로 폴백하고,
// 그마저 안 되면 prompt 로 URL 을 보여줘 손으로 복사하게 한다.
export async function copyText(text, { promptFallback = true } = {}) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true } catch {}
  }
  const ta = document.createElement('textarea')
  try {
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    if (document.execCommand('copy')) return true
  } catch {} finally { ta.remove() }
  if (promptFallback) window.prompt('Automatic copy is unavailable. Copy this link:', text)
  return false
}

// 문서 저장을 감지해 콜백 실행 — vite HMR 의 대체. 게스트(비오너)는 endpoint 권한이 없어 끈다.
// 보이는 탭만 SSE 를 연결한다 — HTTP/1.1 은 서버당 동시 연결 6개 제한이라, 백그라운드 MOA 탭들이
// 연결을 다 물고 있으면 새 페이지 이동·API 가 전부 pending 으로 굳는다. 숨겨진 탭은 연결을 놓고,
// 다시 보이면 재연결 + 즉시 갱신해 놓친 변경을 반영한다.
export function useWatch(slug, enabled, onChange) {
  const ref = useRef(onChange)
  ref.current = onChange
  useEffect(() => {
    if (!enabled) return
    let es = null
    const open = () => {
      if (es) return
      es = new EventSource(slug ? `/api/watch?slug=${encodeURIComponent(slug)}` : '/api/watch')
      es.onmessage = () => ref.current()
    }
    const close = () => { if (es) { es.close(); es = null } }
    const onVis = () => {
      if (document.hidden) close()
      else if (!es) { open(); ref.current() }
    }
    if (!document.hidden) open()
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); close() }
  }, [slug, enabled])
}
