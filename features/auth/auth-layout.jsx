import React from 'react'
import { Brand, Icon } from '../../components/ui/index.jsx'
import styles from './auth.module.css'

export default function AuthLayout({ title, description, children, footer }) {
  return (
    <main className={styles.layout}>
      <div className={styles.frame}>
        <a href="/" className={styles.brandLink} aria-label="MOA home"><Brand /></a>
        <div className={styles.card}>
          <header className={styles.header}>
            <div className={styles.eyebrow}>Your team’s work, together</div>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.description}>{description}</p>
          </header>
          {children}
        </div>
        <div className={styles.footer}><Icon name="lock" size={15} /><span>{footer || 'A private space for your team’s work'}</span></div>
      </div>
    </main>
  )
}
