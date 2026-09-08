import React from 'react'
import { BrandMark } from '../../components/ui/index.jsx'
import styles from './hub.module.css'

export default function HubIdentity() {
  return <a href="/" className={styles.brand} aria-label="MOA home">
    <BrandMark />
    <span>moa</span>
  </a>
}
