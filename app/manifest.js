// Home screen web app manifest — scope:'/' puts the whole site in app scope.
// Without it, iOS treats post-login navigation as out-of-scope and shows the in-app browser bar at the top.
export default function manifest() {
  return {
    name: 'MOA',
    short_name: 'MOA',
    description: 'Unified viewer for AI work reports',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#EFEDE6',
    theme_color: '#2A2925',
    icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
  }
}
