// Content root — where projects/, demo/, registry.json, shares.json live.
// Defaults to the app's working directory. Point MOA_CONTENT_ROOT elsewhere to
// serve content that lives outside this checkout.
import os from 'node:os'
import path from 'node:path'

export const ROOT = process.env.MOA_CONTENT_ROOT || process.cwd()
// Folder browsing / external-project registration is confined to this root.
export const ALLOW = process.env.MOA_BROWSE_ROOT || os.homedir()
export const PROJECTS = path.join(ROOT, 'projects')
export const REGISTRY = path.join(ROOT, 'registry.json')
export const SHARES = path.join(ROOT, 'shares.json')
export const PINS = path.join(ROOT, 'pins.json')
// Media served at the site root (/<folder>/<file>). Next serves the app's own public/ folder,
// so this follows the working directory, not MOA_CONTENT_ROOT.
export const PUBLIC = path.join(process.cwd(), 'public')

export const inAllow = (p) => {
  const r = path.resolve(p)
  return r === ALLOW || r.startsWith(ALLOW + '/')
}
