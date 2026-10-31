import localFont from 'next/font/local'
import TabStrip from '../features/tabs/TabStrip.jsx'
import './globals.css'

const pretendard = localFont({ src: './fonts/PretendardVariable.woff2', display: 'swap', variable: '--font-pretendard', weight: '100 900' })

export const metadata = {
  title: 'MOA',
  description: 'Unified viewer for AI work reports',
  appleWebApp: { capable: true, title: 'MOA', statusBarStyle: 'default' }, // home screen web app — runs standalone
}

// Before the first paint: when this window has tabs to show (lib/tabs.js), the page makes room for the tab strip at
// once, rather than jumping down when the strip renders.
const tabsRoom = `try{var n=window.name,s=JSON.parse(sessionStorage.getItem('moa.tabs')||'null'),p=location.pathname;if(n.indexOf('moa-window:')===0&&s&&s.window===n.slice(11)&&s.tabs&&s.tabs.length>1&&(p==='/'||/^\\/p\\/[^/]/.test(p)))document.documentElement.setAttribute('data-tabs','')}catch(e){}`

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={pretendard.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: tabsRoom }} /></head>
      <body>
        <TabStrip />
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
