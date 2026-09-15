# Design system and verification

The redesign keeps MOA's existing routes, APIs, permission boundaries, document
format, and local configuration. It changes the presentation and organizes it into
shared styles and React components.

- `styles/tokens.css`: color, typography, spacing, surfaces, and motion
- `styles/base.css`, `prose.css`, `legacy.css`: application defaults, reading styles,
  and compatibility with existing report classes
- `components/ui/`: buttons, fields, dialogs, drawers, feedback, icons (a named map
  onto [Lucide](https://lucide.dev)), and the shared symbol
- `components/report/`: the existing 14 MDX component exports
- `features/`: hub, authentication, settings, document navigation, and Claude chat
- `/p/guide/design-system`: interactive examples of the actual components

## Verified result

On 2026-09-08, the production build passed and all **43 browser tests passed**
(31.6 seconds, Chromium). Four English screenshots were captured from that build
and checked at desktop and mobile sizes.

## Feature preservation

Compared with public `main` at `5ef441c`, the 39 files covering API routes, shared-link
routes, authentication, server-side content and account logic, folder restrictions,
and proxy configuration are byte-for-byte unchanged. `MOA_BROWSE_ROOT`,
`MOA_CONTENT_ROOT`, `MOA_PROXIES`, and the existing icon URLs are retained.

Regression review caught and repaired these presentation-layer issues before merging:

- Closing the chat panel must not stop an active task. Responses, the draft, and the
  session remain available when it is reopened; Stop still cancels the task.
- Retrying a document after a rendering error must load the replacement component.
  An updated document received through SSE also clears the error boundary.
- An active document search stays clearable when a live update reduces the document count.
- Demo search results expand while searching, and empty states count matching demos.
- Account identity and project details remain accessible through compact menus.
- Local font variables apply at the root, the header reflows at 200% text size, and
  mobile tables keep English words intact with keyboard-accessible horizontal scrolling.
- Existing progress, callout, media-grid, and `.page` report styles remain supported.
  Both `Total` and `누적` table rows retain their emphasis.

## Reproduce the checks

Use Node with the project's dependencies installed. The browser tests require Playwright Chromium:

```bash
npm ci
npx playwright install chromium
npm run build
```

Stop any server already using port 5001. Start the isolated production review server
in one terminal, then run the suite in another:

```bash
node scripts/review-server.mjs --production
```

```bash
npm run test:ui
```

The review server binds to `127.0.0.1:5001`, uses fictional content under `.review/`,
and confines folder browsing to that directory. A read-only preflight rejects any
server that is not serving the expected fixture path before mutation tests run.
Account, project, document, and share mutations are restored after each test.
Some fixtures intentionally contain Korean text to verify Unicode headings and
existing MDX compatibility in the English interface.

The suite covers:

| Area | Verification |
| --- | --- |
| Authentication | Team and owner login, return URL, validation, invitation signup, used/invalid invitations, logout and cookie removal |
| Projects | Folder registration and removal without changing originals, search, filters, drag and keyboard ordering, persistence and failed-save rollback, hide and restore, demo results |
| Team management | Access editing, admin invitation and revocation, account disable/reactivate/delete, immediate effect on existing sessions |
| Sharing | Guest and member boundaries, link revocation, clipboard failure and manual-copy fallback |
| Reports | Relative JSX/JSON imports, shared components, error isolation, retry and SSE recovery, Unicode anchors, legacy CSS, images and video |
| Navigation | Group persistence, project switching, search after live updates, mobile drawers and focus return |
| Claude interface | Stream rendering, prompts and trigger payloads, resume/history/new session, delayed stop, closing and reopening active tasks |
| Readability | 320, 390, 768, 1280, and 1440px layouts, horizontal overflow, 200% text, reduced motion, automated WCAG A/AA checks |

Claude streams, history, and Terminal triggers use explicitly mocked responses;
the tests do not invoke Claude or launch Terminal. The corresponding server APIs
remain unchanged. Browser checks complement source comparison; they do not establish
that every possible external MDX report or local Claude installation works.

## English screenshots

With the same isolated review server running, and no tests running concurrently:

```bash
npm run capture:readme
```

The capture script temporarily writes fictional English sample content, verifies
that visible text contains no Korean and that there is no horizontal overflow,
waits for local fonts, and captures the actual application. It restores the original
fixture files afterward. No live reports or accounts are used.

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Hub | [home.png](images/home.png) | [home-mobile.png](images/home-mobile.png) |
| Report | [report.png](images/report.png) | [report-mobile.png](images/report-mobile.png) |

Pretendard is bundled locally with its [license](../app/fonts/Pretendard-LICENSE.txt).
