// GET /s/<token>/og/thumb.<ext> — share preview thumbnail (no cookie needed — /s/* is a public path).
// Some chat app scrapers (e.g. KakaoTalk) reject image URLs without an extension, so the path includes one.
// Serves only the doc's first image, and only while the token is valid. Revocation means an immediate 404.
import fs from 'node:fs'
import { findShare, shareOg } from '../../../../../lib/shares.mjs'

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

export async function GET(req, { params }) {
  const { token, name } = await params
  if (!/^thumb\.(jpg|jpeg|png|webp|gif)$/i.test(name)) return new Response('Not found', { status: 404 })
  const share = findShare(token)
  if (!share) return new Response('Not found', { status: 404 })
  const og = shareOg(share)
  if (!og.image) return new Response('No thumbnail', { status: 404 })
  const buf = fs.readFileSync(og.image.file)
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': TYPES[og.image.ext] || 'application/octet-stream',
      'Content-Length': String(buf.length),
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
