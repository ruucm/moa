import localFont from 'next/font/local'
import './globals.css'

const pretendard = localFont({ src: './fonts/PretendardVariable.woff2', display: 'swap', variable: '--font-pretendard', weight: '100 900' })

export const metadata = {
  title: 'MOA',
  description: 'Unified viewer for AI work reports',
  appleWebApp: { capable: true, title: 'MOA', statusBarStyle: 'default' }, // home screen web app — runs standalone
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={pretendard.variable}>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
