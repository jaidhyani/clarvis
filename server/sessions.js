import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from 'fs'
import { homedir } from 'os'
import { join, dirname, basename } from 'path'
import { DATA_DIR } from './config.js'

const SESSION_META_PATH = join(DATA_DIR, 'session-meta.json')
const SDK_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

function ensureDir(filePath) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function encodePath(projectPath) {
  return projectPath.replace(/\//g, '-')
}

function parseSessionFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    for (const line of lines) {
      if (!line) continue
      try {
        const record = JSON.parse(line)
        if (record.type === 'summary') {
          return { title: record.summary }
        }
      } catch {
        // Skip malformed lines
      }
    }
    return { title: null }
  } catch {
    return null
  }
}

export function discoverSessions(projectPath) {
  const encodedPath = encodePath(projectPath)
  const sdkProjectDir = join(SDK_PROJECTS_DIR, encodedPath)

  if (!existsSync(sdkProjectDir)) {
    return []
  }

  try {
    const entries = readdirSync(sdkProjectDir)
    const sessions = []

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue

      const filePath = join(sdkProjectDir, entry)
      try {
        const stat = statSync(filePath)
        if (!stat.isFile()) continue

        const sessionId = basename(entry, '.jsonl')
        const parsed = parseSessionFile(filePath)

        sessions.push({
          id: sessionId,
          title: parsed?.title || null,
          projectPath,
          lastModified: stat.mtimeMs
        })
      } catch {
        // Skip files we can't read
      }
    }

    return sessions.sort((a, b) => b.lastModified - a.lastModified)
  } catch {
    return []
  }
}

export function getSessionMeta() {
  if (!existsSync(SESSION_META_PATH)) {
    return {}
  }
  try {
    const content = readFileSync(SESSION_META_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

export function setSessionMeta(sessionId, meta) {
  const allMeta = getSessionMeta()
  allMeta[sessionId] = { ...allMeta[sessionId], ...meta }
  ensureDir(SESSION_META_PATH)
  writeFileSync(SESSION_META_PATH, JSON.stringify(allMeta, null, 2))
  return allMeta[sessionId]
}

export function deleteSessionMeta(sessionId) {
  const allMeta = getSessionMeta()
  if (!allMeta[sessionId]) return false
  delete allMeta[sessionId]
  ensureDir(SESSION_META_PATH)
  writeFileSync(SESSION_META_PATH, JSON.stringify(allMeta, null, 2))
  return true
}

export function loadSessionHistory(sessionId, projectPath) {
  if (!sessionId || !projectPath) {
    return []
  }

  const encodedPath = encodePath(projectPath)
  const historyFile = join(SDK_PROJECTS_DIR, encodedPath, `${sessionId}.jsonl`)

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

export function touchSessionFile(sessionId, projectPath) {
  const encodedPath = encodePath(projectPath)
  const filePath = join(SDK_PROJECTS_DIR, encodedPath, `${sessionId}.jsonl`)

  if (!existsSync(filePath)) {
    return false
  }

  try {
    const now = new Date()
    utimesSync(filePath, now, now)
    return true
  } catch {
    return false
  }
}
