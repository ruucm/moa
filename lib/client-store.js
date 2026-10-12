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
  // Resolves once the new index is in state, so a caller can wait for what it just saved to come back.
  const reload = useCallback(() => (
    fetchIndex(true).then((next) => { setData(next); setError(null) }).catch((e) => setError(String(e.message || e)))
  ), [])
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
//
// 브라우저는 평문 HTTP/1.1 서버 하나에 연결을 6개까지만 연다. 보이는 탭마다 SSE 를 하나씩 물면 MOA 창
// 여섯 개가 그 6개를 다 써서 새 페이지 이동·API·이미지가 전부 pending 으로 굳는다. 그래서 같은 브라우저의
// 탭들은 SharedWorker(lib/watch-worker.js) 하나가 쥔 /api/watch?all=1 스트림을 나눠 쓴다 — 탭이 몇 개든
// 연결은 하나다. 탭은 보이는 동안만 구독하고, 다시 보이면 스트림이 살아 있다는 답('ready')을 받은 뒤 한 번
// 갱신해 숨어 있던 동안 놓친 변경을 반영한다. SharedWorker 가 없는 브라우저(안드로이드 크롬 등)는 예전처럼
// 보이는 탭마다 SSE 를 직접 연다.
const subs = new Set() // 이 탭의 구독 — { topic, fn, late, timer, es } · topic 은 프로젝트 slug, 허브 목록은 ''
let hub // undefined = 아직 안 열어 봄 · null = SharedWorker 없음(구독마다 SSE) · { port, beat }

const direct = (sub) => {
  sub.es = new EventSource(sub.topic ? `/api/watch?slug=${encodeURIComponent(sub.topic)}` : '/api/watch')
  sub.es.onmessage = () => sub.fn()
}
const caughtUp = (sub) => {
  if (!sub.late) return
  sub.late = false
  clearTimeout(sub.timer)
  sub.fn()
}
const announce = (ask) => hub.port.postMessage({ topics: [...new Set([...subs].map((sub) => sub.topic))], ask: !!ask })

function sharedHub() {
  if (hub !== undefined) return hub
  hub = null
  if (typeof SharedWorker === 'undefined') return hub
  try {
    const worker = new SharedWorker('/api/watch/worker', { name: 'moa-watch' })
    const mine = { port: worker.port }
    // 워커 스크립트를 못 받았다 — 이 탭은 구독마다 SSE 를 직접 여는 쪽으로 돌아간다.
    worker.onerror = () => {
      if (hub !== mine) return
      hub = null
      clearInterval(mine.beat)
      for (const sub of subs) { direct(sub); caughtUp(sub) }
    }
    worker.port.onmessage = ({ data }) => {
      for (const sub of [...subs]) {
        if (data.type === 'ready') caughtUp(sub)
        else if (data.type === 'change' && data.topic === sub.topic) sub.fn()
      }
    }
    // 워커는 탭이 닫힌 걸 알 수 없다 — 10초마다 목록을 다시 보내 살아 있음을 알리고, 떠날 땐 비운다.
    mine.beat = setInterval(() => { if (subs.size) announce() }, 10000)
    window.addEventListener('pagehide', () => { if (hub === mine) mine.port.postMessage({ topics: [] }) })
    hub = mine
  } catch {}
  return hub
}

// late = 숨어 있다 돌아온 구독 — 스트림이 살아 있는 걸 확인한 뒤(2초 안에 답이 없으면 그냥) 한 번 갱신한다.
function subscribe(topic, fn, late) {
  const sub = { topic, fn, late }
  subs.add(sub)
  if (sharedHub()) {
    announce(late)
    if (late) sub.timer = setTimeout(() => caughtUp(sub), 2000)
  } else {
    direct(sub)
    caughtUp(sub)
  }
  return () => {
    subs.delete(sub)
    clearTimeout(sub.timer)
    if (sub.es) sub.es.close()
    else if (hub) announce()
  }
}

export function useWatch(slug, enabled, onChange) {
  const ref = useRef(onChange)
  ref.current = onChange
  useEffect(() => {
    if (!enabled) return
    let stop = null
    const open = (late) => { if (!stop) stop = subscribe(slug || '', () => ref.current(), late) }
    const close = () => { if (stop) { stop(); stop = null } }
    const onVis = () => {
      if (document.hidden) close()
      else open(true)
    }
    if (!document.hidden) open(false)
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); close() }
  }, [slug, enabled])
}
