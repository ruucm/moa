// Team accounts — users.json holds { users: [...], invites: [...], resets: [...] } (git-ignored — contains password hashes).
// user: { id, email, name, hash, role: 'admin'|'member', projects: [slugs], createdAt, disabled, passwordChangedAt? }
//   A member can only access the projects listed in `projects`. Admins ignore it (full access).
//   passwordChangedAt (set by a reset link) — login cookies issued before it are refused (getAuth in lib/api.mjs).
// invite: { token, role, projects, createdAt, exp, usedBy } — single-use, 7 days by default. On signup, `projects` transfers to the account.
// reset: { tokenHash, userId, createdAt, exp, usedAt } — an admin-issued password reset link, single-use, 24 hours.
//   Only the token's sha256 is stored — a reset link takes over an existing account, so users.json alone must not hold one.
// Owner bootstrap: create invites via scripts/add-user.mjs or the legacy owner password (admin login).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT } from './paths.mjs'
import { hashPassword, verifyHash } from './auth.mjs'

export const USERS = path.join(ROOT, 'users.json')
export const INVITE_TTL = 7 * 24 * 3600 * 1000 // invite link lifetime
export const RESET_TTL = 24 * 3600 * 1000 // password reset link lifetime

export const readUsers = () => {
  try {
    const d = JSON.parse(fs.readFileSync(USERS, 'utf8'))
    return { users: d.users || [], invites: d.invites || [], resets: d.resets || [] }
  } catch { return { users: [], invites: [], resets: [] } }
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
  // A pending reset link must not come back to life when the account is reactivated
  if (u.disabled) d.resets = d.resets.filter((r) => r.userId !== id || r.usedAt)
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
  d.resets = d.resets.filter((r) => r.userId !== id)
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

// ── Password resets ──
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

// A new link replaces the account's earlier unused one. Used links stay until they expire so reopening
// one says "already used"; expired entries are dropped here.
export const createReset = (userId) => {
  const d = readUsers()
  const user = d.users.find((u) => u.id === userId)
  if (!user) return { error: 'No such account.' }
  if (user.disabled) return { error: 'Reactivate this account before resetting its password.' }
  const now = Date.now()
  const token = 'rst_' + crypto.randomBytes(24).toString('base64url')
  const reset = { tokenHash: hashToken(token), userId, createdAt: new Date(now).toISOString(), exp: now + RESET_TTL, usedAt: null }
  d.resets = [...d.resets.filter((r) => r.exp > now && (r.userId !== userId || r.usedAt)), reset]
  writeUsers(d)
  return { token, exp: reset.exp }
}

const checkReset = (d, token) => {
  const reset = token ? d.resets.find((r) => r.tokenHash === hashToken(token)) : null
  const user = reset && d.users.find((u) => u.id === reset.userId)
  if (!user) return { error: 'Reset link not found or revoked.' }
  if (reset.usedAt) return { error: 'This reset link has already been used.' }
  if (reset.exp < Date.now()) return { error: 'This reset link has expired — ask an admin for a new one.' }
  if (user.disabled) return { error: 'This account is disabled — ask an admin to reactivate it.' }
  return { reset, user }
}

export const findReset = (token) => checkReset(readUsers(), token)

// Set the new password and spend the link. Id, role, projects and pins (keyed by id) stay as they are.
export const resetPassword = (token, password) => {
  const d = readUsers()
  const r = checkReset(d, token)
  if (r.error) return r
  if (!password || String(password).length < 6) return { error: 'Password must be at least 6 characters.' }
  r.user.hash = hashPassword(password)
  r.user.passwordChangedAt = r.reset.usedAt = new Date().toISOString()
  writeUsers(d)
  return { user: r.user }
}

export const removeResets = (userId) => {
  const d = readUsers()
  d.resets = d.resets.filter((r) => r.userId !== userId || r.usedAt)
  writeUsers(d)
  return { ok: true }
}

// List for the admin UI — never expose hashes
export const listForAdmin = () => {
  const d = readUsers()
  return {
    users: d.users.map(({ hash, ...u }) => u),
    invites: d.invites.filter((i) => !i.usedBy && i.exp > Date.now()),
    resets: d.resets.filter((r) => !r.usedAt && r.exp > Date.now()).map(({ userId, createdAt, exp }) => ({ userId, createdAt, exp })),
  }
}
