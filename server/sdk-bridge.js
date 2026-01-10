import { query } from '@anthropic-ai/claude-agent-sdk'

// Active queries keyed by sessionId
const activeQueries = new Map()

export function createQueryRunner(sessionId, options, callbacks) {
  const { onMessage, onPermissionRequest, onPermissionResolved, onError, onComplete } = callbacks

  const abortController = new AbortController()
  const pendingPermissions = new Map()

  // Custom permission handler that forwards to the UI
  const canUseTool = async (toolName, input) => {
    const requestId = Math.random().toString(36).slice(2)

    // Notify UI about permission request
    onPermissionRequest({
      requestId,
      toolName,
      input
    })

    // Wait for response from UI
    return new Promise((resolve) => {
      pendingPermissions.set(requestId, (decision) => {
        // Notify UI that permission was resolved
        onPermissionResolved?.({
          requestId,
          toolName,
          input,
          decision: decision.behavior,
          message: decision.message
        })
        resolve(decision)
      })
    })
  }

  const queryState = {
    abortController,
    pendingPermissions,
    running: true
  }

  activeQueries.set(sessionId, queryState)

  // Run the query asynchronously
  const runQuery = async () => {
    try {
      const queryOptions = {
        ...options,
        abortController,
        canUseTool,
        includePartialMessages: true,
        settingSources: options.settingSources || ['project'],
        systemPrompt: options.systemPrompt || { type: 'preset', preset: 'claude_code' },
        // Replay conversation history when resuming a session
        extraArgs: options.resume ? { 'replay-user-messages': null } : undefined
      }

      const response = query({
        prompt: options.prompt,
        options: queryOptions
      })

      // Stream all messages to the callback
      for await (const message of response) {
        if (!queryState.running) break
        onMessage(message)
      }

      onComplete()
    } catch (error) {
      if (error.name === 'AbortError') {
        onComplete('interrupted')
      } else {
        onError(error)
      }
    } finally {
      queryState.running = false
      activeQueries.delete(sessionId)
    }
  }

  runQuery()

  return {
    interrupt: () => {
      queryState.running = false
      abortController.abort()
    },
    resolvePermission: (requestId, decision) => {
      const resolver = pendingPermissions.get(requestId)
      if (resolver) {
        pendingPermissions.delete(requestId)
        if (decision.behavior === 'allow') {
          resolver({
            behavior: 'allow',
            updatedInput: decision.updatedInput
          })
        } else {
          resolver({
            behavior: 'deny',
            message: decision.message || 'User denied permission'
          })
        }
        return true
      }
      return false
    }
  }
}

export function getActiveQuery(sessionId) {
  return activeQueries.get(sessionId)
}

export function interruptQuery(sessionId) {
  const queryState = activeQueries.get(sessionId)
  if (queryState) {
    queryState.running = false
    queryState.abortController.abort()
    return true
  }
  return false
}

export async function getSupportedModels() {
  try {
    // Create a minimal query just to get models
    const response = query({
      prompt: '',
      options: { maxTurns: 0 }
    })
    return await response.supportedModels()
  } catch {
    // Return common defaults if we can't query
    return [
      { value: 'sonnet', displayName: 'Claude Sonnet', description: 'Fast and capable' },
      { value: 'opus', displayName: 'Claude Opus', description: 'Most capable' },
      { value: 'haiku', displayName: 'Claude Haiku', description: 'Fastest' }
    ]
  }
}

export async function getSupportedCommands() {
  try {
    const response = query({
      prompt: '',
      options: { maxTurns: 0 }
    })
    return await response.supportedCommands()
  } catch {
    return []
  }
}
