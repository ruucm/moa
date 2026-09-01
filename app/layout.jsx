import './globals.css'

export const metadata = {
  title: 'MOA',
  description: 'Unified viewer for AI work reports',
  appleWebApp: { capable: true, title: 'MOA', statusBarStyle: 'default' }, // home screen web app — runs standalone
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
