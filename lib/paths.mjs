// Content root — where projects/, demo/, public/, registry.json, shares.json live.
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

export const inAllow = (p) => {
  const r = path.resolve(p)
  return r === ALLOW || r.startsWith(ALLOW + '/')
}
