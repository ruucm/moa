// Isolated, explicitly fictional content for UI verification. Never reads live users or reports.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../lib/auth.mjs'

export const reviewRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.review/content')
export const reviewPassword = 'moa-local-review-only'
export const reviewSecret = 'moa-isolated-review-secret-not-for-production'

// Self-contained sample art: no binary fixture files, and no dependency on the app's public dir.
const sampleImage = (label) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#efefeb"/><circle cx="742" cy="132" r="54" fill="#e2e4dd"/><path d="M0 402 L188 286 L332 402 L520 250 L724 402 L960 320 V540 H0Z" fill="#d8dad2"/><text x="480" y="500" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" fill="#20211f">${label}</text></svg>`
)

const report = `export const title = '더 명확하게, 더 편안하게'
export const group = '프로젝트 개요'
export const order = 1
export const date = '2026-09-07'

# 더 명확하게, 더 편안하게

좋은 기록은 다음 행동을 선명하게 만듭니다. 모아는 프로젝트의 과정과 결과를 한곳에 정리하고, 팀이 같은 맥락에서 다음 일을 시작할 수 있도록 돕습니다.

<Badge tone="live">진행 중</Badge> <Badge tone="muted">디자인 검수용 예시</Badge>

## 이번 주의 한눈에 보기

정보의 양보다 중요한 것은 읽는 순서입니다. 핵심 결과를 먼저 확인하고, 필요한 내용은 아래에서 차근차근 살펴보세요.

<Stats items={[
 { label: '정리한 리포트', value: '12', sub: '기록으로 연결된 과정' },
 { label: '완료한 작업', value: '8', sub: '이번 주에 마무리했어요' },
 { label: '전체 진행률', value: '67%', sub: '목표에 가까워지고 있어요', accent: true }
]} />

<Callout type="info" title="읽는 사람을 먼저 생각해요">
제목은 내용을 안내하고, 여백은 생각을 정리할 시간을 줍니다. 중요한 수치와 설명이 자연스럽게 이어지도록 구성했어요.
</Callout>

## 작은 기준이 만드는 일관성

같은 역할에는 같은 표현을 사용합니다. 버튼과 입력, 표와 지표가 공통 컴포넌트를 사용하면 새 문서도 익숙하게 읽을 수 있습니다.

### 이번 주 진행 상황

<DataTable cols={['작업', '담당 영역', '완료', '상태']} rows={[
 ['읽기 경험 정리', '문서 · 탐색', '4', '완료'],
 ['공통 컴포넌트', '디자인 시스템', '3', '완료'],
 ['모바일 검수', '반응형 화면', '1', '진행 중'],
 ['누적', '전체 작업', '8', '차근차근 진행 중']
]} note="이 문서의 프로젝트와 수치는 디자인 검수를 위해 만든 예시입니다." />

### 다음 작업

<Checks items={['✅ 문서의 제목과 본문 위계 정리', '✅ 버튼과 입력의 공통 상태 적용', '모바일에서 긴 제목과 표 검수', '팀 피드백 반영']} />

## 다음으로 이어갈 일

<Timeline items={[
 { d: '09.07', t: '문서 읽기 경험과 디자인 시스템 정리', accent: true, now: true },
 { d: '09.08', t: '데스크톱 · 모바일 화면 검수' },
 { d: '09.09', t: '팀의 의견을 모아 마지막 다듬기' }
]} />

<Progress label="이번 주 작업" value={67} sub="예시 작업 12개 중 8개 완료" />

## 화면으로 함께 보기

<Figure src="${sampleImage('예시 이미지 1')}" cap="문서 이미지 예시 1 — 눌러서 원본 크기로 볼 수 있어요." wide />

![문서 이미지 예시 2 — 마크다운 이미지](${sampleImage('예시 이미지 2')})

<FooterNote>예시 프로젝트 · 모든 내용과 수치는 디자인 검수용 가상 데이터입니다.</FooterNote>
`

const specifications = [
 ['moa-design', '모아 디자인 리뉴얼', '읽는 사람을 위한, 더 편안하고 명확한 문서 경험.', 'active', 4],
 ['brand-notes', '브랜드의 다음 장', '우리가 전하고 싶은 이야기와 시각 언어를 정리해요.', 'active', 3],
 ['product-research', '제품 경험 리서치', '사용자의 목소리에서 다음 개선의 실마리를 찾아요.', 'active', 3],
 ['content-studio', '콘텐츠 스튜디오', '기획부터 발행까지, 콘텐츠가 만들어지는 과정.', 'paused', 2],
 ['team-playbook', '우리 팀의 플레이북', '함께 일하며 쌓아온 원칙과 작은 배움을 모았어요.', 'done', 2],
 ['service-archive', '서비스 운영 아카이브', '작은 개선과 문제 해결의 기록을 차곡차곡.', 'archived', 2],
]

export function createReviewFixtures() {
  fs.mkdirSync(path.join(reviewRoot, 'projects'), { recursive: true })
  const registry = []
  for (const [slug, title, description, status, count] of specifications) {
    const projectPath = path.join(reviewRoot, 'projects', slug)
    fs.mkdirSync(projectPath, { recursive: true })
    fs.writeFileSync(path.join(projectPath, '_meta.json'), JSON.stringify({ title, description, status, order: (registry.length + 1) * 10 }))
    fs.writeFileSync(path.join(projectPath, 'overview.mdx'), report)
    for (let i = 2; i <= count; i++) fs.writeFileSync(path.join(projectPath, `note-${i}.mdx`), `export const title = '${['', '', '관찰과 배움', '이번 주 작업 노트', '다음 단계'][i] || '작업 노트'}'\nexport const group = '작업 기록'\nexport const order = ${i}\nexport const date = '2026-09-0${Math.min(6, i)}'\n\n# 작업의 흐름을 기록해요\n\n이 문서는 디자인 검수용 예시입니다. 과정과 결과, 다음 할 일을 함께 기록합니다.\n\n## 기록의 기준\n\n<Checks items={['✅ 주요 결과 정리', '다음 단계 확인']} />\n`)
    registry.push({ slug, path: projectPath, title, description, status, order: (registry.length + 1) * 10 })
  }
  const guide = path.join(reviewRoot, 'projects', 'guide')
  fs.mkdirSync(guide, { recursive: true })
  fs.writeFileSync(path.join(guide, '_meta.json'), JSON.stringify({ title: 'MOA Design System', description: '화면을 만드는 공통 기준과 실제 컴포넌트.', status: 'active', order: 70 }))
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  for (const filename of ['components.mdx', 'design-system.mdx']) fs.copyFileSync(path.join(projectRoot, 'projects/guide', filename), path.join(guide, filename))
  fs.writeFileSync(path.join(guide, 'runtime-error.mdx'), `export const title = '렌더 오류 검수'\nexport const order = 98\n\n# 런타임 오류\n\n{(() => { throw new Error('검수용 렌더 오류') })()}\n`)
  fs.writeFileSync(path.join(guide, 'compile-error.mdx'), 'export const title = "컴파일 오류 검수"\nexport const order = 99\n\n<Unclosed>')
  const empty = path.join(reviewRoot, 'projects', 'empty-project')
  fs.mkdirSync(empty, { recursive: true })
  registry.push({ slug: 'empty-project', path: empty, title: '아직 기록이 없는 프로젝트', status: 'active', order: 80 })
  fs.writeFileSync(path.join(reviewRoot, 'registry.json'), JSON.stringify({ projects: registry, hidden: ['empty-project'] }, null, 2))
  const now = new Date().toISOString()
  const users = [
    { id: 'review-admin', email: 'review@moa.example', name: '디자인 검수 · 예시', role: 'admin', projects: [] },
    { id: 'review-member', email: 'member@moa.example', name: '팀원 예시', role: 'member', projects: ['moa-design', 'brand-notes'] },
  ].map(user => ({ ...user, hash: hashPassword(reviewPassword), createdAt: now, disabled: false }))
  fs.writeFileSync(path.join(reviewRoot, 'users.json'), JSON.stringify({ users, invites: [{ token: 'review-invitation-only', role: 'member', projects: ['moa-design'], createdAt: now, exp: Date.now() + 86400000 }] }, null, 2))
  fs.writeFileSync(path.join(reviewRoot, 'shares.json'), JSON.stringify({ shares: [{ token: 'review-document-link-only', slug: 'moa-design', doc: 'overview', media: [], api: [], createdAt: now }] }, null, 2))
  fs.writeFileSync(path.join(reviewRoot, 'projects', 'moa-design', 'long-content.mdx'), `export const title = '아주 긴 한글 제목과 표 그리고 URL의 반응형 읽기 검수'\nexport const group = '검수'\nexport const order = 20\n\n# 아주 긴 한글 제목도 좁은 화면에서 편안하게 읽을 수 있어야 합니다\n\n${'한글 문장과 숫자, 여러 가지 내용을 함께 기록합니다. '.repeat(8)}\n\nhttps://example.invalid/${'long-segment-'.repeat(30)}\n\n<DataTable cols={['첫 번째 열','두 번째 열','세 번째 열','네 번째 열','다섯 번째 열']} rows={[[ '${'아주긴단어'.repeat(12)}','예시','예시','예시','예시']]} />\n\n## 같은 제목\n\n첫 문단입니다.\n\n## 같은 제목\n\n두 번째 문단입니다.\n`)
  return reviewRoot
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { createReviewFixtures(); console.log('Isolated review fixtures ready in .review/content (fictional data).') }
