#!/usr/bin/env node
// Set the owner password — writes MOA_PASSWORD_HASH (scrypt) + MOA_SECRET to .env.local.
// Usage:  node scripts/set-password.mjs <new password>
// Restart the server afterwards to apply. Changing the password keeps MOA_SECRET
// (so existing login cookies survive). To invalidate all cookies too, delete .env.local and run again.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const pw = process.argv[2]
if (!pw || pw.length < 4) {
  console.error('Usage: node scripts/set-password.mjs <new password>  (min 4 characters)')
  process.exit(1)
}

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local')
let lines = []
try { lines = fs.readFileSync(envFile, 'utf8').split('\n') } catch {}

const salt = crypto.randomBytes(16).toString('hex')
const hash = crypto.scryptSync(pw, salt, 32).toString('hex')
const set = (key, val) => {
  const i = lines.findIndex((l) => l.startsWith(key + '='))
  if (i >= 0) lines[i] = `${key}=${val}`
  else lines.push(`${key}=${val}`)
}
// `$` gets eaten by .env variable expansion, so use `:` as the separator
set('MOA_PASSWORD_HASH', `scrypt:${salt}:${hash}`)
if (!lines.some((l) => l.startsWith('MOA_SECRET=')))
  set('MOA_SECRET', crypto.randomBytes(32).toString('hex'))

fs.writeFileSync(envFile, lines.filter(Boolean).join('\n') + '\n')
console.log('Saved: ' + envFile)
console.log('Restart the server to apply.')
