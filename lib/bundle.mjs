// Doc bundler — bundles a single .mdx into one CJS chunk with esbuild.
// Project-local components (../src/*.jsx) and JSON imported via relative paths get bundled in,
// while react / @mdx-js/react stay external so the client injects the app's instances
// (global component injection only works with the same React and the same MDXProvider context).
// The cache invalidates on the mtime of every input file in the bundle — saving triggers a fresh bundle on the next request.
import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import mdx from '@mdx-js/esbuild'
import remarkGfm from 'remark-gfm'

const cache = new Map() // absPath → { inputs: [{file, mtimeMs}], code }

const fresh = (entry) => {
  for (const { file, mtimeMs } of entry.inputs) {
    try { if (fs.statSync(file).mtimeMs !== mtimeMs) return false } catch { return false }
  }
  return true
}

export const bundleDoc = async (absPath) => {
  const hit = cache.get(absPath)
  if (hit && fresh(hit)) return { code: hit.code }
  try {
    const r = await esbuild.build({
      entryPoints: [absPath],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'browser',
      jsx: 'automatic',
      metafile: true,
      logLevel: 'silent',
      external: ['react', 'react/jsx-runtime', 'react-dom', '@mdx-js/react'],
      plugins: [mdx({ providerImportSource: '@mdx-js/react', remarkPlugins: [remarkGfm] })],
    })
    const code = r.outputFiles[0].text
    const inputs = Object.keys(r.metafile.inputs)
      .map((f) => path.resolve(f))
      .map((file) => { try { return { file, mtimeMs: fs.statSync(file).mtimeMs } } catch { return null } })
      .filter(Boolean)
    cache.set(absPath, { inputs, code })
    return { code }
  } catch (e) {
    // A broken doc only errors that doc — unlike the old vite eager approach, which took down the whole hub
    const msg = (e.errors || []).map((x) => `${x.location ? x.location.file + ':' + x.location.line + ' ' : ''}${x.text}`).join('\n') || String(e.message || e)
    return { error: msg }
  }
}
