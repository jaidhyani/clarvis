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

// Load message history from SDK's JSONL files
export function loadSessionHistory(session) {
  if (!session?.sdkSessionId || !session?.projectPath) {
    return []
  }

  // SDK stores sessions in ~/.claude/projects/ with path encoded as directory name
  const encodedPath = session.projectPath.replace(/\//g, '-')
  const sdkProjectDir = join(homedir(), '.claude', 'projects', encodedPath)
  const historyFile = join(sdkProjectDir, `${session.sdkSessionId}.jsonl`)

  if (!existsSync(historyFile)) {
    return []
  }

  try {
    const content = readFileSync(historyFile, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const messages = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        // Only include user and assistant messages, skip queue-operations and other internal types
        if (entry.type === 'user' || entry.type === 'assistant') {
          messages.push(entry)
        }
      } catch {
        // Skip malformed lines
      }
    }

    return messages
  } catch {
    return []
  }
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
