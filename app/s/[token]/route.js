// GET /s/<token> — share link entry point.
// Humans (browsers): check shares.json → issue a scope cookie → 302 to the doc (relative path —
//   the req.url host can't be trusted when started with -H 0.0.0.0).
// Crawlers (link scrapers from chat apps e.g. KakaoTalk, Facebook, etc.): respond 200 with HTML containing OG meta (title/description/thumbnail).
//   The thumbnail is served by /s/<token>/og, which is accessible without cookies.
import { findShare, shareOg } from '../../../lib/shares.mjs'
import { isOwner, shareSetCookie, SHARE_TTL } from '../../../lib/auth.mjs'

const redirect = (path, headers = {}) =>
  new Response(null, { status: 302, headers: { Location: path, ...headers } })

// Match scrapers only — app names like 'kakaotalk' or 'line/' also appear in in-app browser UAs,
// which would show the OG stub page to people who tapped the link. (KakaoTalk's scraper is kakaotalk-scrap, LINE's is line-poker)
const CRAWLER = /facebookexternalhit|facebot|kakaotalk-scrap|kakaostory|twitterbot|slackbot|telegrambot|whatsapp|discordbot|linkedinbot|line-poker|skypeuripreview|pinterest|bot|crawler|spider|scrap/i

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export async function GET(req, { params }) {
  const { token } = await params
  const share = findShare(token)
  if (!share)
    return redirect('/login?msg=' + encodeURIComponent('This share link has expired or been revoked.'))

  const ua = req.headers.get('user-agent') || ''
  if (CRAWLER.test(ua)) {
    const og = shareOg(share)
    const host = req.headers.get('host') || 'localhost:5001'
    // Some chat app scrapers (e.g. KakaoTalk) won't download og:image from a non-standard port (:5001 etc.) —
    // set MOA_PUBLIC_ORIGIN to a public address reachable on 80/443 and URLs are built from that.
    const base = (process.env.MOA_PUBLIC_ORIGIN || '').replace(/\/+$/, '') || `http://${host}`
    console.log(`[share-og] token=${token} host=${host} ua=${ua.slice(0, 120)}`)
    // Some scrapers (e.g. KakaoTalk) ignore image URLs without an extension — serve as /og/thumb.jpg style
    const imgUrl = og.image ? `${base}/s/${token}/og/thumb${og.image.ext}` : null
    const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(og.title)}</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(og.title)}">
<meta property="og:description" content="${esc(og.description)}">
<meta property="og:url" content="${esc(`${base}/s/${token}`)}">
${imgUrl ? `<meta property="og:image" content="${esc(imgUrl)}">
${TYPES[og.image.ext] ? `<meta property="og:image:type" content="${TYPES[og.image.ext]}">` : ''}
${og.image.dims ? `<meta property="og:image:width" content="${og.image.dims.w}">
<meta property="og:image:height" content="${og.image.dims.h}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(imgUrl)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(og.title)}">
</head><body>${esc(og.title)}</body></html>`
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  const dest = `/p/${encodeURIComponent(share.slug)}/${encodeURIComponent(share.doc)}`
  if (isOwner(req)) return redirect(dest)
  const cookie = shareSetCookie({
    t: share.token, s: share.slug, d: share.doc,
    m: share.media || [], a: share.api || [], exp: Date.now() + SHARE_TTL,
  })
  return redirect(dest, { 'Set-Cookie': cookie })
}
