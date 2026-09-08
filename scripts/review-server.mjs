import { spawn } from 'node:child_process'
import { createReviewFixtures, reviewRoot, reviewSecret, reviewPassword } from './review-fixtures.mjs'
import { hashPassword } from '../lib/auth.mjs'

createReviewFixtures()
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.argv.includes('--production') ? 'start' : 'dev', '-p', '5001', '-H', '127.0.0.1'], {
  stdio: 'inherit',
  env: { ...process.env, MOA_CONTENT_ROOT: reviewRoot, MOA_BROWSE_ROOT: reviewRoot, MOA_SECRET: reviewSecret, MOA_PASSWORD_HASH: hashPassword(reviewPassword), MOA_NO_AUTH: '0' },
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal))
server.on('exit', code => process.exit(code || 0))
