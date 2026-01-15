import { marked } from './lib/marked.esm.js'

// highlight.js loaded via script tag, available as window.hljs
const hljs = window.hljs

// Configure marked with syntax highlighting
marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  }
})

// Render markdown to HTML string
export function renderMarkdown(text) {
  if (!text) return ''
  return marked.parse(text)
}

// Highlight JSON for config editor
export function highlightJson(text) {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language: 'json' }).value
  } catch {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

// localStorage helpers with namespaced keys
const getStorageKey = (key) => {
  const serverUrl = window.location.host
  return `clarvis-${key}-${serverUrl}`
}

export const loadFromStorage = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(getStorageKey(key))
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

export const saveToStorage = (key, value) => {
  try {
    localStorage.setItem(getStorageKey(key), JSON.stringify(value))
  } catch {
    // localStorage might be full or disabled
  }
}

// Group sessions by project path
export function groupSessionsByProject(sessions, collapseState, sessionOrder) {
  const groups = {}

  for (const session of sessions) {
    const projectPath = session.projectPath || 'unknown'
    const projectName = projectPath.split('/').pop() || 'Unknown'

    if (!groups[projectPath]) {
      groups[projectPath] = {
        name: projectName,
        path: projectPath,
        sessions: [],
        archivedSessions: [],
        latestActivity: 0,
        collapsed: collapseState[projectPath] ?? false
      }
    }

    if (session.archived) {
      groups[projectPath].archivedSessions.push(session)
    } else {
      groups[projectPath].sessions.push(session)
      groups[projectPath].latestActivity = Math.max(
        groups[projectPath].latestActivity,
        session.lastActivity || 0
      )
    }
  }

  // Sort sessions within each project by custom order or default (latest first)
  for (const path of Object.keys(groups)) {
    const customOrder = sessionOrder[path]
    const sortFn = (a, b) => {
      if (customOrder && customOrder.length > 0) {
        const aIdx = customOrder.indexOf(a.id)
        const bIdx = customOrder.indexOf(b.id)
        if (aIdx === -1 && bIdx === -1) return (b.lastActivity || 0) - (a.lastActivity || 0)
        if (aIdx === -1) return 1
        if (bIdx === -1) return -1
        return aIdx - bIdx
      }
      return (b.lastActivity || 0) - (a.lastActivity || 0)
    }
    groups[path].sessions.sort(sortFn)
    groups[path].archivedSessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
  }

  // Sort projects by latest activity
  return Object.values(groups).sort((a, b) => b.latestActivity - a.latestActivity)
}

// Fuzzy match: check if all characters in query appear in order in target
export function fuzzyMatch(query, target) {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (const char of t) {
    if (char === q[qi]) qi++
    if (qi === q.length) return true
  }
  return false
}

// Score fuzzy matches (lower is better) - prioritizes matches at start
export function fuzzyScore(query, target) {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // Exact prefix match is best
  if (t.startsWith(q)) return 0

  // Count how early the match characters appear
  let score = 0
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += i
      qi++
    }
  }
  return score
}
