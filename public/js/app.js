import { h, render } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import htm from 'htm'
import { createWebSocket } from './ws.js'

// Bind htm to preact's h function
const html = htm.bind(h)

// Connection states
const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  AUTH_ERROR: 'auth_error'
}

// Main App component
function App() {
  const [password, setPassword] = useState(() => localStorage.getItem('clarvis_password') || '')
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED)
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [messages, setMessages] = useState({}) // sessionId -> messages[]
  const [projects, setProjects] = useState([])
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [permissionRequests, setPermissionRequests] = useState({}) // sessionId -> request
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)
  const seenMessageIds = useRef(new Map()) // sessionId -> Set of message uuids we've processed

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, activeSessionId])

  // Connect to WebSocket
  const connect = useCallback((authPassword) => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    setConnectionState(ConnectionState.CONNECTING)

    wsRef.current = createWebSocket(authPassword, {
      onConnect: () => {
        setConnectionState(ConnectionState.CONNECTED)
        localStorage.setItem('clarvis_password', authPassword)
        // Request initial data
        wsRef.current.send({ type: 'list_sessions' })
        wsRef.current.send({ type: 'list_projects' })
      },
      onDisconnect: () => {
        setConnectionState(ConnectionState.DISCONNECTED)
      },
      onAuthError: () => {
        setConnectionState(ConnectionState.AUTH_ERROR)
        localStorage.removeItem('clarvis_password')
        setPassword('')
      },
      onReconnecting: () => {
        setConnectionState(ConnectionState.CONNECTING)
      },
      onMessage: (msg) => handleMessage(msg)
    })
  }, [])

  // Handle incoming messages
  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'connected':
        break

      case 'sessions':
        setSessions(msg.sessions || [])
        break

      case 'projects':
        setProjects(msg.projects || [])
        break

      case 'query_started':
        // Subscribe to the session
        wsRef.current?.send({ type: 'subscribe', sessionId: msg.sessionId })
        setActiveSessionId(msg.sessionId)
        break

      case 'message': {
        const sdkMsg = msg.message
        const sessionId = msg.sessionId

        // Skip init messages - not useful to display
        if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
          break
        }

        // Get or create the set of seen message IDs for this session
        if (!seenMessageIds.current.has(sessionId)) {
          seenMessageIds.current.set(sessionId, new Set())
        }
        const seen = seenMessageIds.current.get(sessionId)

        // If message has a uuid and we've seen it, skip (handles replays/duplicates)
        if (sdkMsg.uuid && seen.has(sdkMsg.uuid)) {
          break
        }

        // Mark as seen
        if (sdkMsg.uuid) {
          seen.add(sdkMsg.uuid)
        }

        setMessages(prev => {
          const sessionMsgs = prev[sessionId] || []

          // For user messages from SDK, check if we have a pending local version to replace
          if (sdkMsg.type === 'user' && sdkMsg.uuid) {
            const pendingIdx = sessionMsgs.findIndex(m => m._pending && m.type === 'user')
            if (pendingIdx !== -1) {
              // Replace pending with confirmed SDK message
              const updated = [...sessionMsgs]
              updated[pendingIdx] = sdkMsg
              return { ...prev, [sessionId]: updated }
            }
          }

          // Otherwise just append
          return { ...prev, [sessionId]: [...sessionMsgs, sdkMsg] }
        })
        break
      }

      case 'session_status':
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, status: msg.status } : s
        ))
        break

      case 'session_sdk_id':
        // Update local session with SDK session ID for resume support
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, sdkSessionId: msg.sdkSessionId } : s
        ))
        break

      case 'permission_request':
        setPermissionRequests(prev => ({
          ...prev,
          [msg.sessionId]: msg
        }))
        break

      case 'permission_resolved':
        setPermissionRequests(prev => {
          const next = { ...prev }
          delete next[msg.sessionId]
          return next
        })
        break

      case 'query_complete':
        // Refresh sessions list
        wsRef.current?.send({ type: 'list_sessions' })
        break

      case 'project_created':
        setProjects(prev => [...prev, msg.project].sort((a, b) => a.name.localeCompare(b.name)))
        break

      case 'session_deleted':
        setSessions(prev => prev.filter(s => s.id !== msg.sessionId))
        setMessages(prev => {
          const next = { ...prev }
          delete next[msg.sessionId]
          return next
        })
        break

      case 'session_renamed':
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, name: msg.name } : s
        ))
        break

      case 'history': {
        // Received historical messages from SDK storage
        const sessionId = msg.sessionId
        const history = msg.messages || []

        // Initialize or reset the seen message IDs for this session
        if (!seenMessageIds.current.has(sessionId)) {
          seenMessageIds.current.set(sessionId, new Set())
        }
        const seen = seenMessageIds.current.get(sessionId)

        // Mark all history messages as seen and add their uuids
        for (const histMsg of history) {
          if (histMsg.uuid) {
            seen.add(histMsg.uuid)
          }
        }

        // Set the messages for this session
        setMessages(prev => ({ ...prev, [sessionId]: history }))
        break
      }

      case 'error':
        console.error('Server error:', msg.error)
        break
    }
  }, [])

  // Auto-connect if we have a stored password
  useEffect(() => {
    if (password) {
      connect(password)
    }
    return () => {
      wsRef.current?.close()
    }
  }, [])

  // Send prompt
  const sendPrompt = useCallback((prompt) => {
    if (!activeSessionId || !wsRef.current) return

    const session = sessions.find(s => s.id === activeSessionId)
    if (!session) return

    // Add user message locally for immediate feedback (marked as pending)
    // Will be replaced when SDK confirms with the real message (with uuid)
    setMessages(prev => ({
      ...prev,
      [activeSessionId]: [...(prev[activeSessionId] || []), {
        type: 'user',
        message: { content: [{ type: 'text', text: prompt }] },
        _pending: true
      }]
    }))

    wsRef.current.send({
      type: 'query',
      sessionId: activeSessionId,
      options: {
        prompt,
        cwd: session.projectPath,
        name: session.name,
        resume: session.sdkSessionId
      }
    })
  }, [activeSessionId, sessions])

  // Start new session
  const startNewSession = useCallback((project) => {
    const sessionId = Math.random().toString(36).slice(2)

    // Add to local sessions immediately
    setSessions(prev => [...prev, {
      id: sessionId,
      name: project.name,
      projectPath: project.path,
      status: 'idle'
    }])

    setMessages(prev => ({ ...prev, [sessionId]: [] }))
    setActiveSessionId(sessionId)
    setShowNewSessionModal(false)
    setSidebarOpen(false)

    // Subscribe to the session
    wsRef.current?.send({ type: 'subscribe', sessionId })
  }, [])

  // Handle permission response
  const handlePermission = useCallback((sessionId, requestId, decision, input) => {
    wsRef.current?.send({
      type: 'permission',
      sessionId,
      requestId,
      decision,
      updatedInput: decision === 'allow' ? input : undefined
    })
  }, [])

  // Delete session
  const deleteSession = useCallback((sessionId) => {
    wsRef.current?.send({ type: 'delete_session', sessionId })
    if (activeSessionId === sessionId) {
      setActiveSessionId(null)
    }
  }, [activeSessionId])

  // Rename session
  const renameSession = useCallback((sessionId, name) => {
    wsRef.current?.send({ type: 'rename_session', sessionId, name })
  }, [])

  // Auth screen
  if (connectionState === ConnectionState.AUTH_ERROR || (!password && connectionState === ConnectionState.DISCONNECTED)) {
    return html`<${AuthScreen}
      onSubmit=${(p) => { setPassword(p); connect(p); }}
      error=${connectionState === ConnectionState.AUTH_ERROR}
    />`
  }

  const activeSession = sessions.find(s => s.id === activeSessionId)
  const activeMessages = messages[activeSessionId] || []
  const activePermission = permissionRequests[activeSessionId]

  return html`
    <div class="app-layout">
      <${Sidebar}
        sessions=${sessions}
        activeSessionId=${activeSessionId}
        onSelectSession=${(id) => {
          setActiveSessionId(id)
          setSidebarOpen(false)
          // Request history from server (reads from SDK's JSONL files)
          wsRef.current?.send({ type: 'get_history', sessionId: id })
        }}
        onNewSession=${() => setShowNewSessionModal(true)}
        onDeleteSession=${deleteSession}
        onRenameSession=${renameSession}
        isOpen=${sidebarOpen}
        connectionState=${connectionState}
      />

      <div class="main-content">
        <${MainHeader}
          session=${activeSession}
          onMenuClick=${() => setSidebarOpen(!sidebarOpen)}
          connectionState=${connectionState}
        />

        ${activeSession ? html`
          <${MessageStream}
            messages=${activeMessages}
            messagesEndRef=${messagesEndRef}
            isLoading=${activeSession.status === 'running' && !activePermission}
          />

          ${activePermission && html`
            <${PermissionCard}
              request=${activePermission}
              onAllow=${() => handlePermission(activeSessionId, activePermission.requestId, 'allow', activePermission.input)}
              onDeny=${() => handlePermission(activeSessionId, activePermission.requestId, 'deny')}
            />
          `}

          <${PromptInput}
            onSubmit=${sendPrompt}
            disabled=${activeSession.status === 'running'}
          />
        ` : html`
          <${EmptyState}
            onNewSession=${() => setShowNewSessionModal(true)}
          />
        `}
      </div>

      ${showNewSessionModal && html`
        <${NewSessionModal}
          projects=${projects}
          onSelect=${startNewSession}
          onClose=${() => setShowNewSessionModal(false)}
          onCreateProject=${(name) => wsRef.current?.send({ type: 'create_project', name })}
        />
      `}
    </div>
  `
}

// Auth screen component
function AuthScreen({ onSubmit, error }) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password.trim()) {
      onSubmit(password.trim())
    }
  }

  return html`
    <div class="auth-screen">
      <div class="auth-card">
        <h1 class="auth-title">Clarvis</h1>
        <p class="auth-subtitle">Enter your password to connect</p>

        ${error && html`
          <div class="auth-error">
            Invalid password. Please check and try again.
          </div>
        `}

        <form onSubmit=${handleSubmit}>
          <div class="form-group">
            <label>Password</label>
            <input
              type="password"
              value=${password}
              onInput=${(e) => setPassword(e.target.value)}
              placeholder="Paste password from terminal..."
              autofocus
            />
          </div>
          <button type="submit" class="btn btn-primary" style="width: 100%">
            Connect
          </button>
        </form>
      </div>
    </div>
  `
}

// Sidebar component
function Sidebar({ sessions, activeSessionId, onSelectSession, onNewSession, onDeleteSession, onRenameSession, isOpen, connectionState }) {
  return html`
    <aside class="sidebar ${isOpen ? 'open' : ''}">
      <div class="sidebar-header">
        <h1>Clarvis</h1>
        <div class="connection-indicator ${connectionState}"></div>
      </div>
      <div class="sidebar-content">
        <button class="btn btn-primary" style="width: 100%; margin-bottom: 12px" onClick=${onNewSession}>
          + New Session
        </button>
        <div class="session-list">
          ${sessions.map(session => html`
            <${SessionCard}
              key=${session.id}
              session=${session}
              isActive=${session.id === activeSessionId}
              onClick=${() => onSelectSession(session.id)}
              onDelete=${() => onDeleteSession(session.id)}
              onRename=${(name) => onRenameSession(session.id, name)}
            />
          `)}
        </div>
      </div>
    </aside>
  `
}

// Session card component
function SessionCard({ session, isActive, onClick, onDelete, onRename }) {
  const [showMenu, setShowMenu] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(session.name)

  const handleContextMenu = (e) => {
    e.preventDefault()
    setShowMenu(true)
  }

  const handleRename = () => {
    if (newName.trim() && newName !== session.name) {
      onRename(newName.trim())
    }
    setIsRenaming(false)
    setShowMenu(false)
  }

  const handleDelete = (e) => {
    e.stopPropagation()
    if (confirm('Delete this session?')) {
      onDelete()
    }
    setShowMenu(false)
  }

  return html`
    <div
      class="session-card ${isActive ? 'active' : ''}"
      onClick=${onClick}
      onContextMenu=${handleContextMenu}
    >
      <div class="session-card-header">
        ${isRenaming ? html`
          <input
            type="text"
            class="session-rename-input"
            value=${newName}
            onInput=${(e) => setNewName(e.target.value)}
            onBlur=${handleRename}
            onKeyDown=${(e) => e.key === 'Enter' && handleRename()}
            onClick=${(e) => e.stopPropagation()}
            autofocus
          />
        ` : html`
          <span class="session-card-name">${session.name}</span>
        `}
        <span class="session-card-status ${session.status}"></span>
      </div>
      ${session.lastMessagePreview && html`
        <div class="session-card-preview">${session.lastMessagePreview}</div>
      `}
      ${showMenu && html`
        <div class="session-menu" onClick=${(e) => e.stopPropagation()}>
          <button onClick=${() => { setIsRenaming(true); setShowMenu(false); }}>Rename</button>
          <button onClick=${handleDelete} class="danger">Delete</button>
          <button onClick=${() => setShowMenu(false)}>Cancel</button>
        </div>
      `}
    </div>
  `
}

// Main header component
function MainHeader({ session, onMenuClick, connectionState }) {
  return html`
    <header class="main-header">
      <button class="btn btn-icon" onClick=${onMenuClick} style="display: none">
        ☰
      </button>
      <span class="main-header-title">${session?.name || 'No session selected'}</span>
      <div class="connection-indicator ${connectionState}"></div>
    </header>
  `
}

// Message stream component
function MessageStream({ messages, messagesEndRef, isLoading }) {
  return html`
    <div class="message-stream">
      ${messages.map((msg, i) => html`
        <${Message} key=${i} message=${msg} />
      `)}
      ${isLoading && html`
        <div class="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      `}
      <div ref=${messagesEndRef}></div>
    </div>
  `
}

// Message component
function Message({ message }) {
  if (message.type === 'user') {
    const content = message.message?.content
    const text = Array.isArray(content)
      ? content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : content
    if (!text) return null
    return html`<div class="message message-user">${text}</div>`
  }

  if (message.type === 'assistant') {
    const content = message.message?.content
    // Only extract text, tool_use blocks will be handled below
    const text = Array.isArray(content)
      ? content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : content
    // Don't render empty assistant messages
    if (!text) return null
    return html`<div class="message message-assistant">${text}</div>`
  }

  // Hide init messages - they're confusing after the user's first prompt
  if (message.type === 'system' && message.subtype === 'init') {
    return null
  }

  // Permission resolution message
  if (message.type === 'permission') {
    const allowed = message.decision === 'allow'
    return html`
      <div class="message message-system" style="display: flex; align-items: center; gap: 8px;">
        <span style="color: ${allowed ? 'var(--accent-success)' : 'var(--accent-error)'}">
          ${allowed ? '✓' : '✗'}
        </span>
        <span>
          ${allowed ? 'Allowed' : 'Denied'}: ${message.toolName}
          ${message.decisionMessage ? ` - ${message.decisionMessage}` : ''}
        </span>
      </div>
    `
  }

  // Tool calls are rendered inline with content blocks
  if (message.message?.content) {
    const content = message.message.content
    const rendered = content.map((block, i) => {
      if (block.type === 'text' && block.text?.trim()) {
        return html`<div key=${i} class="message message-assistant">${block.text}</div>`
      }
      if (block.type === 'tool_use') {
        return html`<${ToolCall} key=${i} name=${block.name} input=${block.input} />`
      }
      if (block.type === 'tool_result') {
        return html`<${ToolResult} key=${i} content=${block.content} />`
      }
      return null
    }).filter(Boolean)

    if (rendered.length === 0) return null
    return html`${rendered}`
  }

  return null
}

// Tool call component
function ToolCall({ name, input }) {
  const [expanded, setExpanded] = useState(false)

  const summary = typeof input === 'object'
    ? Object.entries(input).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(', ')
    : String(input).slice(0, 50)

  return html`
    <div class="tool-call">
      <div class="tool-call-header" onClick=${() => setExpanded(!expanded)}>
        <span class="tool-call-icon">${expanded ? '▼' : '▶'}</span>
        <span class="tool-call-name">${name}</span>
        <span class="tool-call-summary">${summary}</span>
      </div>
      <div class="tool-call-body ${expanded ? '' : 'hidden'}">
        ${JSON.stringify(input, null, 2)}
      </div>
    </div>
  `
}

// Tool result component
function ToolResult({ content }) {
  const [expanded, setExpanded] = useState(false)

  const text = Array.isArray(content)
    ? content.filter(c => c.type === 'text').map(c => c.text).join('\n')
    : String(content || '')

  // Don't render empty results
  if (!text.trim()) return null

  const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '')

  return html`
    <div class="tool-call">
      <div class="tool-call-header" onClick=${() => setExpanded(!expanded)}>
        <span class="tool-call-icon">${expanded ? '▼' : '▶'}</span>
        <span class="tool-call-name" style="color: var(--accent-success)">Result</span>
        <span class="tool-call-summary">${preview}</span>
      </div>
      <div class="tool-call-body ${expanded ? '' : 'hidden'}">
        ${text}
      </div>
    </div>
  `
}

// Permission card component
function PermissionCard({ request, onAllow, onDeny }) {
  return html`
    <div class="permission-card">
      <div class="permission-card-header">
        ⚠️ Permission Required
      </div>
      <div class="permission-card-tool">
        <strong>${request.toolName}</strong>
        <pre style="margin-top: 8px; white-space: pre-wrap; word-break: break-all;">
          ${JSON.stringify(request.input, null, 2)}
        </pre>
      </div>
      <div class="permission-card-actions">
        <button class="btn btn-success" onClick=${onAllow}>Allow</button>
        <button class="btn btn-danger" onClick=${onDeny}>Deny</button>
      </div>
    </div>
  `
}

// Prompt input component
function PromptInput({ onSubmit, disabled }) {
  const [value, setValue] = useState('')
  const textareaRef = useRef(null)

  const handleSubmit = () => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim())
      setValue('')
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [value])

  return html`
    <div class="prompt-container">
      <div class="prompt-input-wrapper">
        <textarea
          ref=${textareaRef}
          class="prompt-input"
          value=${value}
          onInput=${(e) => setValue(e.target.value)}
          onKeyDown=${handleKeyDown}
          placeholder=${disabled ? 'Waiting for response...' : 'Type a message...'}
          disabled=${disabled}
          rows="1"
        ></textarea>
        <button
          class="btn btn-primary"
          onClick=${handleSubmit}
          disabled=${disabled || !value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  `
}

// Empty state component
function EmptyState({ onNewSession }) {
  return html`
    <div class="empty-state">
      <div class="empty-state-icon">💬</div>
      <div class="empty-state-title">No session selected</div>
      <p>Select a session from the sidebar or create a new one.</p>
      <button class="btn btn-primary" style="margin-top: 16px" onClick=${onNewSession}>
        + New Session
      </button>
    </div>
  `
}

// New session modal component
function NewSessionModal({ projects, onSelect, onClose, onCreateProject }) {
  const [newProjectName, setNewProjectName] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  const handleCreate = () => {
    if (newProjectName.trim()) {
      onCreateProject(newProjectName.trim())
      setNewProjectName('')
      setShowCreateForm(false)
    }
  }

  return html`
    <div class="modal-overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">New Session</h2>
        </div>
        <div class="modal-body">
          ${projects.length > 0 ? html`
            <p style="margin-bottom: 12px; color: var(--text-secondary);">Select a project:</p>
            <div class="project-list">
              ${projects.map(project => html`
                <div class="project-item" key=${project.path} onClick=${() => onSelect(project)}>
                  <div class="project-item-name">${project.name}</div>
                  <div class="project-item-path">${project.path}</div>
                </div>
              `)}
            </div>
          ` : html`
            <p style="color: var(--text-secondary);">No projects found in projects directory.</p>
          `}

          ${showCreateForm ? html`
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color);">
              <div class="form-group">
                <label>Project Name</label>
                <input
                  type="text"
                  value=${newProjectName}
                  onInput=${(e) => setNewProjectName(e.target.value)}
                  placeholder="my-project"
                  autofocus
                />
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-primary" onClick=${handleCreate} disabled=${!newProjectName.trim()}>
                  Create
                </button>
                <button class="btn btn-secondary" onClick=${() => setShowCreateForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ` : html`
            <button
              class="btn btn-secondary"
              style="margin-top: 16px; width: 100%"
              onClick=${() => setShowCreateForm(true)}
            >
              + Create New Project
            </button>
          `}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onClick=${onClose}>Cancel</button>
        </div>
      </div>
    </div>
  `
}

// Render the app
render(html`<${App} />`, document.getElementById('app'))
