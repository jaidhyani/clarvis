import { validatePassword } from './auth.js'
import { discoverSessions, discoverProjects, loadSessionHistory, getSessionMeta, setSessionMeta, deleteSessionMeta, touchSessionFile } from './sessions.js'
import { createQueryRunner, interruptQuery, getSupportedModels, getSupportedCommands, getActiveQuery } from './sdk-bridge.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir, freemem, totalmem, cpus, loadavg } from 'os'
import { join, dirname } from 'path'

// Config file paths by type
const CONFIG_PATHS = {
  settings: '.claude/settings.json',
  local: '.claude/settings.local.json',
  mcp: '.mcp.json'
}

// JSON schemas for validation
const SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    permissions: {
      type: 'object',
      properties: {
        allow: { type: 'array', items: { type: 'string' } },
        deny: { type: 'array', items: { type: 'string' } },
        ask: { type: 'array', items: { type: 'string' } }
      }
    },
    env: { type: 'object' },
    hooks: { type: 'object' },
    model: { type: 'string' }
  }
}

const MCP_SCHEMA = {
  type: 'object',
  properties: {
    mcpServers: { type: 'object' }
  }
}

function validateJsonSchema(data, schema) {
  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { valid: false, error: 'Expected object' }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (data[key] !== undefined) {
          const result = validateJsonSchema(data[key], propSchema)
          if (!result.valid) {
            return { valid: false, error: `${key}: ${result.error}` }
          }
        }
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      return { valid: false, error: 'Expected array' }
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const result = validateJsonSchema(data[i], schema.items)
        if (!result.valid) {
          return { valid: false, error: `[${i}]: ${result.error}` }
        }
      }
    }
  } else if (schema.type === 'string') {
    if (typeof data !== 'string') {
      return { valid: false, error: 'Expected string' }
    }
  }
  return { valid: true }
}

function readConfigFile(projectPath, configType) {
  const relativePath = CONFIG_PATHS[configType]
  if (!relativePath) {
    return { error: `Unknown config type: ${configType}` }
  }

  const fullPath = join(projectPath, relativePath)
  if (!existsSync(fullPath)) {
    return { content: '', exists: false }
  }

  try {
    const content = readFileSync(fullPath, 'utf-8')
    return { content, exists: true }
  } catch (err) {
    return { error: `Failed to read file: ${err.message}` }
  }
}

function writeConfigFile(projectPath, configType, content) {
  const relativePath = CONFIG_PATHS[configType]
  if (!relativePath) {
    return { error: `Unknown config type: ${configType}` }
  }

  // Validate JSON syntax
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    return { error: `Invalid JSON: ${err.message}` }
  }

  // Validate against schema
  const schema = configType === 'mcp' ? MCP_SCHEMA : SETTINGS_SCHEMA
  const validation = validateJsonSchema(parsed, schema)
  if (!validation.valid) {
    return { error: `Schema validation failed: ${validation.error}` }
  }

  const fullPath = join(projectPath, relativePath)
  const dir = dirname(fullPath)

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(fullPath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { error: `Failed to write file: ${err.message}` }
  }
}

// Track WebSocket connections by sessionId for broadcasting
const sessionConnections = new Map()

// Runtime status tracking (not persisted)
const runtimeStatus = new Map()

function addConnection(sessionId, ws) {
  if (!sessionConnections.has(sessionId)) {
    sessionConnections.set(sessionId, new Set())
  }
  sessionConnections.get(sessionId).add(ws)
}

function removeConnection(sessionId, ws) {
  const connections = sessionConnections.get(sessionId)
  if (connections) {
    connections.delete(ws)
    if (connections.size === 0) {
      sessionConnections.delete(sessionId)
    }
  }
}

function broadcast(sessionId, message) {
  const connections = sessionConnections.get(sessionId)
  if (connections) {
    const data = JSON.stringify(message)
    for (const ws of connections) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(data)
      }
    }
  }
}

function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message))
  }
}

function setRuntimeStatus(sessionId, status, projectPath) {
  runtimeStatus.set(sessionId, { status, projectPath })
}

function clearRuntimeStatus(sessionId) {
  runtimeStatus.delete(sessionId)
}

export function handleConnection(ws, req, config) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const password = url.searchParams.get('password')

  if (!validatePassword(password)) {
    send(ws, { type: 'error', error: 'Invalid or missing password' })
    ws.close(4001, 'Unauthorized')
    return
  }

  // Track which sessions this connection is subscribed to
  const subscribedSessions = new Set()

  ws.on('message', async (data) => {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      send(ws, { type: 'error', error: 'Invalid JSON' })
      return
    }

    try {
      await handleMessage(ws, message, config, subscribedSessions)
    } catch (error) {
      send(ws, { type: 'error', error: error.message })
    }
  })

  ws.on('close', () => {
    // Clean up subscriptions
    for (const sessionId of subscribedSessions) {
      removeConnection(sessionId, ws)
    }
  })

  // Send initial connection success
  send(ws, { type: 'connected' })
}

async function handleMessage(ws, message, config, subscribedSessions) {
  switch (message.type) {
    case 'list_projects': {
      const projects = discoverProjects(config.projectsRoot)
      send(ws, { type: 'projects', projects })
      break
    }

    case 'list_sessions': {
      const projects = discoverProjects(config.projectsRoot)
      const sessionMeta = getSessionMeta()
      const allSessions = []

      for (const project of projects) {
        const sessions = discoverSessions(project.path)
        for (const session of sessions) {
          const meta = sessionMeta[session.id] || {}
          const runtime = runtimeStatus.get(session.id)
          allSessions.push({
            id: session.id,
            name: meta.name || session.title || 'Untitled',
            projectPath: session.projectPath,
            status: runtime?.status || 'idle',
            lastActivity: session.lastModified,
            archived: meta.archived || false
          })
        }
      }

      send(ws, { type: 'sessions', sessions: allSessions })
      break
    }

    case 'get_models': {
      const models = await getSupportedModels()
      send(ws, { type: 'models', models })
      break
    }

    case 'get_commands': {
      const commands = await getSupportedCommands()
      send(ws, { type: 'commands', commands })
      break
    }

    case 'get_status': {
      const oauthPath = join(homedir(), '.claude', '.credentials.json')
      const hasOAuth = existsSync(oauthPath)
      const hasApiKey = !!process.env.ANTHROPIC_API_KEY

      let authType = 'none'
      if (hasOAuth) authType = 'oauth'
      else if (hasApiKey) authType = 'api_key'

      const totalMemory = totalmem()
      const freeMemory = freemem()
      const usedMemory = totalMemory - freeMemory
      const cpuCount = cpus().length
      const load = loadavg()

      send(ws, {
        type: 'status',
        auth: {
          type: authType,
          hasOAuth,
          hasApiKey
        },
        system: {
          memoryUsed: usedMemory,
          memoryTotal: totalMemory,
          memoryPercent: Math.round((usedMemory / totalMemory) * 100),
          cpuCount,
          loadAvg: load[0]
        }
      })
      break
    }

    case 'subscribe': {
      const { sessionId } = message
      if (sessionId) {
        subscribedSessions.add(sessionId)
        addConnection(sessionId, ws)
        send(ws, { type: 'subscribed', sessionId })
      }
      break
    }

    case 'unsubscribe': {
      const { sessionId } = message
      if (sessionId) {
        subscribedSessions.delete(sessionId)
        removeConnection(sessionId, ws)
        send(ws, { type: 'unsubscribed', sessionId })
      }
      break
    }

    case 'query': {
      const { sessionId, options } = message

      // Support both legacy 'prompt' string and new 'content' array format
      const hasContent = Array.isArray(options?.content) && options.content.length > 0
      const hasPrompt = !!options?.prompt

      if (!hasContent && !hasPrompt) {
        send(ws, { type: 'error', error: 'prompt or content required' })
        return
      }

      if (!options?.cwd) {
        send(ws, { type: 'error', error: 'cwd required' })
        return
      }

      const isNewSession = !sessionId
      let activeSessionId = sessionId

      // If resuming existing session, pass it to SDK
      if (sessionId) {
        options.resume = sessionId
      }

      // Create query runner
      createQueryRunner(activeSessionId, options, {
        onMessage: (sdkMessage) => {
          // Extract session_id from init message for new sessions
          if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
            const sdkSessionId = sdkMessage.session_id

            if (isNewSession) {
              activeSessionId = sdkSessionId

              // Subscribe to the new session
              subscribedSessions.add(activeSessionId)
              addConnection(activeSessionId, ws)

              // Notify client about the new session
              send(ws, {
                type: 'session_created',
                sessionId: sdkSessionId,
                projectPath: options.cwd
              })
            }

            setRuntimeStatus(activeSessionId, 'running', options.cwd)
          }

          if (activeSessionId) {
            broadcast(activeSessionId, { type: 'message', sessionId: activeSessionId, message: sdkMessage })
          }
        },
        onPermissionRequest: (request) => {
          if (activeSessionId) {
            setRuntimeStatus(activeSessionId, 'waiting_permission', options.cwd)
            broadcast(activeSessionId, {
              type: 'permission_request',
              sessionId: activeSessionId,
              ...request
            })
            broadcast(activeSessionId, { type: 'session_status', sessionId: activeSessionId, status: 'waiting_permission' })
          }
        },
        onPermissionResolved: (resolution) => {
          if (activeSessionId) {
            broadcast(activeSessionId, {
              type: 'message',
              sessionId: activeSessionId,
              message: {
                type: 'permission',
                toolName: resolution.toolName,
                input: resolution.input,
                decision: resolution.decision,
                decisionMessage: resolution.message
              }
            })
          }
        },
        onError: (error) => {
          if (activeSessionId) {
            setRuntimeStatus(activeSessionId, 'error', options.cwd)
            broadcast(activeSessionId, { type: 'error', sessionId: activeSessionId, error: error.message })
            broadcast(activeSessionId, { type: 'session_status', sessionId: activeSessionId, status: 'error' })
          }
        },
        onComplete: (reason) => {
          if (activeSessionId) {
            clearRuntimeStatus(activeSessionId)
            broadcast(activeSessionId, { type: 'query_complete', sessionId: activeSessionId, reason })
            broadcast(activeSessionId, { type: 'session_status', sessionId: activeSessionId, status: 'idle' })
          }
        }
      })

      // For existing sessions, subscribe and notify immediately
      if (!isNewSession) {
        subscribedSessions.add(sessionId)
        addConnection(sessionId, ws)
        setRuntimeStatus(sessionId, 'running', options.cwd)
        broadcast(sessionId, { type: 'session_status', sessionId, status: 'running' })
      }

      send(ws, { type: 'query_started', sessionId: activeSessionId })
      break
    }

    case 'get_history': {
      const { sessionId, projectPath } = message

      if (!sessionId || !projectPath) {
        send(ws, { type: 'error', error: 'sessionId and projectPath required' })
        return
      }

      const history = loadSessionHistory(sessionId, projectPath)
      send(ws, { type: 'history', sessionId, messages: history })
      break
    }

    case 'interrupt': {
      const { sessionId } = message
      const success = interruptQuery(sessionId)
      send(ws, { type: 'interrupt_result', sessionId, success })
      break
    }

    case 'permission': {
      const { sessionId, requestId, decision, updatedInput } = message
      const queryState = getActiveQuery(sessionId)

      if (!queryState) {
        send(ws, { type: 'error', error: 'No active query for session' })
        return
      }

      const resolved = queryState.pendingPermissions.get(requestId)
      if (resolved) {
        queryState.pendingPermissions.delete(requestId)

        if (decision === 'allow') {
          resolved({
            behavior: 'allow',
            updatedInput
          })
        } else {
          resolved({
            behavior: 'deny',
            message: 'User denied permission'
          })
        }

        setRuntimeStatus(sessionId, 'running', runtimeStatus.get(sessionId)?.projectPath)
        broadcast(sessionId, { type: 'session_status', sessionId, status: 'running' })
        send(ws, { type: 'permission_resolved', sessionId, requestId })
      } else {
        send(ws, { type: 'error', error: 'Permission request not found' })
      }
      break
    }

    case 'create_project': {
      const { name } = message
      if (!name) {
        send(ws, { type: 'error', error: 'Project name required' })
        return
      }

      const { mkdirSync, existsSync } = await import('fs')
      const { join } = await import('path')
      const projectPath = join(config.projectsRoot, name)

      if (existsSync(projectPath)) {
        send(ws, { type: 'error', error: 'Project already exists' })
        return
      }

      try {
        mkdirSync(projectPath, { recursive: true })
        send(ws, { type: 'project_created', project: { name, path: projectPath } })
      } catch (error) {
        send(ws, { type: 'error', error: `Failed to create project: ${error.message}` })
      }
      break
    }

    case 'delete_session': {
      const { sessionId } = message
      deleteSessionMeta(sessionId)
      clearRuntimeStatus(sessionId)
      send(ws, { type: 'session_deleted', sessionId, success: true })
      break
    }

    case 'rename_session': {
      const { sessionId, name } = message
      setSessionMeta(sessionId, { name })
      send(ws, { type: 'session_renamed', sessionId, name })
      break
    }

    case 'archive_session': {
      const { sessionId } = message
      setSessionMeta(sessionId, { archived: true })
      send(ws, { type: 'session_archived', sessionId })
      break
    }

    case 'restore_session': {
      const { sessionId, projectPath } = message
      setSessionMeta(sessionId, { archived: false })
      touchSessionFile(sessionId, projectPath)
      send(ws, { type: 'session_restored', sessionId })
      break
    }

    case 'read_config': {
      const { projectPath, configType } = message
      if (!projectPath || !configType) {
        send(ws, { type: 'error', error: 'projectPath and configType required' })
        return
      }
      const result = readConfigFile(projectPath, configType)
      if (result.error) {
        send(ws, { type: 'error', error: result.error })
      } else {
        send(ws, { type: 'config_content', configType, content: result.content, exists: result.exists })
      }
      break
    }

    case 'write_config': {
      const { projectPath, configType, content } = message
      if (!projectPath || !configType || content === undefined) {
        send(ws, { type: 'error', error: 'projectPath, configType, and content required' })
        return
      }
      const result = writeConfigFile(projectPath, configType, content)
      if (result.error) {
        send(ws, { type: 'config_error', configType, error: result.error })
      } else {
        send(ws, { type: 'config_saved', configType })
      }
      break
    }

    default:
      send(ws, { type: 'error', error: `Unknown message type: ${message.type}` })
  }
}
