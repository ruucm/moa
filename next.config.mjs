// Optional same-origin proxies to other local dev servers, so MDX docs can embed
// live tools (review UIs, studios, dashboards) without CORS or extra ports.
// Configure via MOA_PROXIES, e.g.  MOA_PROXIES="studio:5300,review:5318"
//   → /studio/* → http://127.0.0.1:5300/*  ·  /review/* → http://127.0.0.1:5318/*
// Matching is per path segment, so prefixes never collide.
const PROXIES = (process.env.MOA_PROXIES || '')
  .split(',')
  .map((s) => s.trim().split(':'))
  .filter(([key, port]) => key && /^\d+$/.test(port || ''))

export default {
  // Hide the dev-mode Next.js indicator in the bottom corner
  devIndicators: false,
  // The MDX bundler (esbuild) ships native binaries — load it from node_modules
  // instead of bundling it into the server build
  serverExternalPackages: ['esbuild', '@mdx-js/esbuild'],
  async rewrites() {
    return PROXIES.map(([key, port]) => (
      { source: `/${key}/:path*`, destination: `http://127.0.0.1:${port}/:path*` }
    ))
  },
}
