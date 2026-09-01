// Team accounts — users.json holds { users: [...], invites: [...] } (git-ignored — contains password hashes).
// user: { id, email, name, hash, role: 'admin'|'member', projects: [slugs], createdAt, disabled }
//   A member can only access the projects listed in `projects`. Admins ignore it (full access).
// invite: { token, role, projects, createdAt, exp, usedBy } — single-use, 7 days by default. On signup, `projects` transfers to the account.
// Owner bootstrap: create invites via scripts/add-user.mjs or the legacy owner password (admin login).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT } from './paths.mjs'
import { hashPassword, verifyHash } from './auth.mjs'

export const USERS = path.join(ROOT, 'users.json')
export const INVITE_TTL = 7 * 24 * 3600 * 1000 // invite link lifetime

export const readUsers = () => {
  try {
    const d = JSON.parse(fs.readFileSync(USERS, 'utf8'))
    return { users: d.users || [], invites: d.invites || [] }
  } catch { return { users: [], invites: [] } }
}
const writeUsers = (d) => fs.writeFileSync(USERS, JSON.stringify(d, null, 2) + '\n')

export const findUserById = (id) => readUsers().users.find((u) => u.id === id) || null
export const findUserByEmail = (email) => {
  const e = String(email || '').trim().toLowerCase()
  return readUsers().users.find((u) => u.email === e) || null
}

// Verify email+password — returns the user on success, null on failure. Disabled accounts also return null.
export const verifyUser = (email, password) => {
  const u = findUserByEmail(email)
  if (!u || u.disabled) return null
  return verifyHash(password, u.hash) ? u : null
}

const cleanSlugs = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))]

export const createUser = ({ email, name, password, role = 'member', projects = [] }) => {
  const e = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'Invalid email format.' }
  if (!name || !String(name).trim()) return { error: 'Please enter a name.' }
  if (!password || String(password).length < 6) return { error: 'Password must be at least 6 characters.' }
  const d = readUsers()
  if (d.users.some((u) => u.email === e)) return { error: 'This email is already registered.' }
  const user = {
    id: 'u_' + crypto.randomBytes(6).toString('hex'),
    email: e,
    name: String(name).trim(),
    hash: hashPassword(password),
    role: role === 'admin' ? 'admin' : 'member',
    projects: cleanSlugs(projects),
    createdAt: new Date().toISOString(),
    disabled: false,
  }
  d.users.push(user)
  writeUsers(d)
  return { user }
}

export const setUserDisabled = (id, disabled) => {
  const d = readUsers()
  const u = d.users.find((x) => x.id === id)
  if (!u) return { error: 'No such account.' }
  u.disabled = !!disabled
  writeUsers(d)
  return { ok: true }
}

export const setUserProjects = (id, projects) => {
  const d = readUsers()
  const u = d.users.find((x) => x.id === id)
  if (!u) return { error: 'No such account.' }
  u.projects = cleanSlugs(projects)
  writeUsers(d)
  return { ok: true, projects: u.projects }
}

// Can this member access the project? — always true for admins
export const canAccessProject = (user, slug) =>
  user.role === 'admin' || (user.projects || []).includes(slug)

export const removeUser = (id) => {
  const d = readUsers()
  const before = d.users.length
  d.users = d.users.filter((x) => x.id !== id)
  if (d.users.length === before) return { error: 'No such account.' }
  writeUsers(d)
  return { ok: true }
}

// ── Invites ──
export const createInvite = (role = 'member', projects = []) => {
  const d = readUsers()
  const invite = {
    token: 'inv_' + crypto.randomBytes(12).toString('base64url'),
    role: role === 'admin' ? 'admin' : 'member',
    projects: cleanSlugs(projects),
    createdAt: new Date().toISOString(),
    exp: Date.now() + INVITE_TTL,
    usedBy: null,
  }
  d.invites.push(invite)
  writeUsers(d)
  return invite
}

export const findInvite = (token) => {
  const inv = readUsers().invites.find((i) => i.token === token)
  if (!inv) return { error: 'Invite link not found or revoked.' }
  if (inv.usedBy) return { error: 'This invite link has already been used.' }
  if (inv.exp < Date.now()) return { error: 'This invite link has expired — ask an admin for a new one.' }
  return { invite: inv }
}

export const consumeInvite = (token, userId) => {
  const d = readUsers()
  const inv = d.invites.find((i) => i.token === token)
  if (inv) { inv.usedBy = userId; writeUsers(d) }
}

export const removeInvite = (token) => {
  const d = readUsers()
  d.invites = d.invites.filter((i) => i.token !== token)
  writeUsers(d)
  return { ok: true }
}

// List for the admin UI — never expose hashes
export const listForAdmin = () => {
  const d = readUsers()
  return {
    users: d.users.map(({ hash, ...u }) => u),
    invites: d.invites.filter((i) => !i.usedBy && i.exp > Date.now()),
  }
}
