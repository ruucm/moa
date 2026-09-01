// Add an account directly — for bootstrapping the first admin. Writes straight to users.json without the server.
//   node scripts/add-user.mjs <email> <name> <password> [admin|member]
// Does not need MOA_SECRET from .env.local (it only creates the account, not cookies).
import { createUser } from '../lib/users.mjs'

const [email, name, password, role = 'admin'] = process.argv.slice(2)
if (!email || !name || !password) {
  console.error('Usage: node scripts/add-user.mjs <email> <name> <password> [admin|member]')
  process.exit(1)
}
const r = createUser({ email, name, password, role })
if (r.error) { console.error('Failed:', r.error); process.exit(1) }
console.log(`Added: ${r.user.email} (${r.user.role}) — you can now log in at /login with email+password.`)
