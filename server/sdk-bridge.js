import { query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { existsSync } from 'fs'

// Find the Claude Code executable path
function findClaudeExecutable() {
  // 1. Explicit env var takes priority
  if (process.env.CLAUDE_CODE_PATH && existsSync(process.env.CLAUDE_CODE_PATH)) {
    return process.env.CLAUDE_CODE_PATH
  }

  // 2. Check native install location first (preferred)
  const nativeInstallPath = `${process.env.HOME}/.local/bin/claude`
  if (existsSync(nativeInstallPath)) {
    return nativeInstallPath
  }

  // 3. Try to find it in PATH using 'which'
  try {
    const whichResult = execSync('which claude', { encoding: 'utf-8' }).trim()
    if (whichResult && existsSync(whichResult)) {
      return whichResult
    }
  } catch {
    // 'which' failed, continue to fallbacks
  }

  // 4. Check other common locations
  const otherPaths = [
    '/usr/local/bin/claude',
    '/usr/bin/claude'
  ]

  for (const p of otherPaths) {
    if (existsSync(p)) {
      return p
    }
  }

  // 5. Return default, let SDK handle the error if not found
  return nativeInstallPath
}

const claudeExecutablePath = findClaudeExecutable()

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
        settingSources: options.settingSources || ['user', 'project'],
        systemPrompt: options.systemPrompt || { type: 'preset', preset: 'claude_code' },
        // Replay conversation history when resuming a session
        extraArgs: options.resume ? { 'replay-user-messages': null } : undefined,
        pathToClaudeCodeExecutable: claudeExecutablePath
      }

      // SDK expects prompt as string or AsyncIterable<SDKUserMessage>
      // Always use AsyncIterable format for consistency (works for both text and images)
      let prompt
      if (options.content && Array.isArray(options.content)) {
        prompt = (async function* () {
          yield {
            type: 'user',
            message: { role: 'user', content: options.content },
            parent_tool_use_id: null,
            session_id: options.resume || ''
          }
        })()
      } else {
        // Legacy string prompt fallback
        prompt = options.prompt || ''
      }

      const response = query({
        prompt,
        options: queryOptions
      })

      // Stream all messages to the callback
      for await (const message of response) {
        if (!queryState.running) break
        onMessage(message)
      }
      onComplete()
    } catch (error) {
      // Check if this is an abort-related error (can have different names/messages depending on source)
      const isAbortError = error.name === 'AbortError' ||
                          error.message?.includes('aborted') ||
                          error.message?.includes('abort')
      if (!isAbortError) {
        console.error('[sdk-bridge] Query error:', error)
        onError(error)
      } else {
        onComplete('interrupted')
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
