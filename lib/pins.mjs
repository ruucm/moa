// Pinned pages — each account keeps its own, in pins.json at the content root (untracked, like users.json):
// { "<account>": { "<project slug>": ["<doc slug>", …] } }, the latest pin first. The account is "owner" for the
// owner password and "user:<id>" for a team account. A pin goes by the document's file name.
import fs from 'node:fs'
import { PINS } from './paths.mjs'

const readPins = () => {
  try { return JSON.parse(fs.readFileSync(PINS, 'utf8')) } catch { return {} }
}

const account = (auth) => (auth.user ? `user:${auth.user.id}` : 'owner')

// The projects with the account's pins of each, limited to documents that exist: a pin whose file is
// missing shows again when the file is back.
export const withPins = (projects, auth) => {
  const mine = readPins()[account(auth)] || {}
  return projects.map((p) => {
    const pins = Array.isArray(mine[p.slug]) ? [...new Set(mine[p.slug])].filter((doc) => p.docs.some((d) => d.slug === doc)) : []
    return pins.length ? { ...p, pins } : p
  })
}

// Pins `doc` of project `slug` for the account, above its other pins, or unpins it.
export const savePin = (auth, slug, doc, pinned) => {
  const all = readPins()
  const mine = { ...(all[account(auth)] || {}) }
  const docs = (Array.isArray(mine[slug]) ? mine[slug] : []).filter((entry) => entry !== doc)
  if (pinned) docs.unshift(doc)
  if (docs.length) mine[slug] = docs
  else delete mine[slug]
  if (Object.keys(mine).length) all[account(auth)] = mine
  else delete all[account(auth)]
  fs.writeFileSync(PINS, JSON.stringify(all, null, 2) + '\n')
}
