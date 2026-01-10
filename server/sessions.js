import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

const SESSIONS_PATH = join(homedir(), '.clarvis', 'sessions.json')

function ensureDir(filePath) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function loadSessions() {
  if (!existsSync(SESSIONS_PATH)) {
    return {}
  }
  try {
    const content = readFileSync(SESSIONS_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

function saveSessions(sessions) {
  ensureDir(SESSIONS_PATH)
  writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2))
}

export function getAllSessions() {
  return loadSessions()
}

export function getSession(sessionId) {
  const sessions = loadSessions()
  return sessions[sessionId] || null
}

export function saveSession(sessionId, data) {
  const sessions = loadSessions()
  sessions[sessionId] = {
    ...data,
    id: sessionId,
    lastActivity: Date.now()
  }
  saveSessions(sessions)
  return sessions[sessionId]
}

export function updateSession(sessionId, updates) {
  const sessions = loadSessions()
  if (!sessions[sessionId]) {
    return null
  }
  sessions[sessionId] = {
    ...sessions[sessionId],
    ...updates,
    lastActivity: Date.now()
  }
  saveSessions(sessions)
  return sessions[sessionId]
}

export function deleteSession(sessionId) {
  const sessions = loadSessions()
  if (!sessions[sessionId]) {
    return false
  }
  delete sessions[sessionId]
  saveSessions(sessions)
  return true
}

export function discoverProjects(projectsRoot) {
  if (!existsSync(projectsRoot)) {
    return []
  }

  try {
    const entries = readdirSync(projectsRoot)
    const projects = []

    for (const entry of entries) {
      const fullPath = join(projectsRoot, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory() && !entry.startsWith('.')) {
          projects.push({
            name: entry,
            path: fullPath
          })
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    return projects.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export { SESSIONS_PATH }
