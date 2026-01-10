import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { join, dirname } from 'path'

const AUTH_TOKEN_PATH = join(homedir(), '.clarvis', 'auth-token')

function ensureDir(filePath) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function getToken() {
  if (!existsSync(AUTH_TOKEN_PATH)) {
    return null
  }
  try {
    return readFileSync(AUTH_TOKEN_PATH, 'utf-8').trim()
  } catch {
    return null
  }
}

export function generateToken() {
  const token = randomBytes(32).toString('hex')
  ensureDir(AUTH_TOKEN_PATH)
  writeFileSync(AUTH_TOKEN_PATH, token, { mode: 0o600 })
  return token
}

export function ensureToken() {
  let token = getToken()
  if (!token) {
    token = generateToken()
  }
  return token
}

export function validateToken(providedToken) {
  const storedToken = getToken()
  if (!storedToken) {
    return false
  }
  return providedToken === storedToken
}

export { AUTH_TOKEN_PATH }
