'use client'
import React from 'react'
import { Icon } from '../../components/ui/index.jsx'
import styles from './hub.module.css'

export default function ProjectToolbar({ query, onQueryChange, status, onStatusChange }) {
  return <div className={styles.toolbar}>
    <div className={styles.filter}>
      <select aria-label="Project status" value={status} onChange={event => onStatusChange(event.target.value)}>
        <option value="all">All projects</option><option value="active">Active projects</option>
        <option value="paused">Paused projects</option><option value="done">Completed projects</option><option value="archived">Archived projects</option>
      </select>
      <Icon name="chevronDown" size={15}/>
    </div>
    <div className={styles.search}>
      <Icon name="search" size={17}/>
      <input type="search" aria-label="Search projects" placeholder="Find a project" value={query} onChange={event => onQueryChange(event.target.value)}/>
    </div>
  </div>
}
