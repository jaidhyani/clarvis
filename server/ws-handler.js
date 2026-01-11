import { validatePassword } from './auth.js'
import { getAllSessions, getSession, saveSession, updateSession, deleteSession, discoverProjects, loadSessionHistory } from './sessions.js'
import { createQueryRunner, interruptQuery, getSupportedModels, getSupportedCommands, getActiveQuery } from './sdk-bridge.js'

// Track WebSocket connections by sessionId for broadcasting
const sessionConnections = new Map()

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
      const sessions = getAllSessions()
      send(ws, { type: 'sessions', sessions: Object.values(sessions) })
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

      if (!options?.prompt) {
        send(ws, { type: 'error', error: 'prompt required' })
        return
      }

      if (!options?.cwd) {
        send(ws, { type: 'error', error: 'cwd required' })
        return
      }

      // Generate sessionId if not provided
      const sid = sessionId || Math.random().toString(36).slice(2)

      // Subscribe to this session
      subscribedSessions.add(sid)
      addConnection(sid, ws)

      // Save/update session info
      saveSession(sid, {
        name: options.name || 'Untitled',
        projectPath: options.cwd,
        status: 'running'
      })

      // Notify about session start
      broadcast(sid, { type: 'session_status', sessionId: sid, status: 'running' })

      // Create query runner
      createQueryRunner(sid, options, {
        onMessage: (sdkMessage) => {
          broadcast(sid, { type: 'message', sessionId: sid, message: sdkMessage })

          // Extract session_id from init message for SDK resume
          if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
            updateSession(sid, { sdkSessionId: sdkMessage.session_id })
            // Notify frontend so it can update local session state
            broadcast(sid, {
              type: 'session_sdk_id',
              sessionId: sid,
              sdkSessionId: sdkMessage.session_id
            })
          }
        },
        onPermissionRequest: (request) => {
          updateSession(sid, { status: 'waiting_permission' })
          broadcast(sid, {
            type: 'permission_request',
            sessionId: sid,
            ...request
          })
          broadcast(sid, { type: 'session_status', sessionId: sid, status: 'waiting_permission' })
        },
        onPermissionResolved: (resolution) => {
          // Send permission resolution as a message so it appears in chat history
          broadcast(sid, {
            type: 'message',
            sessionId: sid,
            message: {
              type: 'permission',
              toolName: resolution.toolName,
              input: resolution.input,
              decision: resolution.decision,
              decisionMessage: resolution.message
            }
          })
        },
        onError: (error) => {
          updateSession(sid, { status: 'error' })
          broadcast(sid, { type: 'error', sessionId: sid, error: error.message })
          broadcast(sid, { type: 'session_status', sessionId: sid, status: 'error' })
        },
        onComplete: (reason) => {
          updateSession(sid, { status: 'idle' })
          broadcast(sid, { type: 'query_complete', sessionId: sid, reason })
          broadcast(sid, { type: 'session_status', sessionId: sid, status: 'idle' })
        }
      })

      send(ws, { type: 'query_started', sessionId: sid })
      break
    }

    case 'resume': {
      const { sessionId } = message
      const session = getSession(sessionId)

      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' })
        return
      }

      // Subscribe to this session
      subscribedSessions.add(sessionId)
      addConnection(sessionId, ws)

      // Send session info
      send(ws, { type: 'session_info', session })
      break
    }

    case 'get_history': {
      const { sessionId } = message
      const session = getSession(sessionId)

      if (!session) {
        send(ws, { type: 'error', error: 'Session not found' })
        return
      }

      // Load history from SDK's JSONL files
      const history = loadSessionHistory(session)
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

        updateSession(sessionId, { status: 'running' })
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
      const success = deleteSession(sessionId)
      send(ws, { type: 'session_deleted', sessionId, success })
      break
    }

    case 'rename_session': {
      const { sessionId, name } = message
      const updated = updateSession(sessionId, { name })
      if (updated) {
        send(ws, { type: 'session_renamed', sessionId, name })
      } else {
        send(ws, { type: 'error', error: 'Session not found' })
      }
      break
    }

    default:
      send(ws, { type: 'error', error: `Unknown message type: ${message.type}` })
  }
}
