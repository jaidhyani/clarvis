import { h, render } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import htm from 'htm'
import { marked } from './lib/marked.esm.js'
import { createWebSocket } from './ws.js'

// highlight.js loaded via script tag, available as window.hljs
const hljs = window.hljs

// Bind htm to preact's h function
const html = htm.bind(h)

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
function renderMarkdown(text) {
  if (!text) return ''
  return marked.parse(text)
}

// Highlight JSON for config editor
function highlightJson(text) {
  if (!text) return ''
  try {
    return hljs.highlight(text, { language: 'json' }).value
  } catch {
    // If highlighting fails, escape HTML and return plain text
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

// Connection states
const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  AUTH_ERROR: 'auth_error'
}

// localStorage helpers with namespaced keys
const getStorageKey = (key) => {
  const serverUrl = window.location.host
  return `clarvis-${key}-${serverUrl}`
}

const loadFromStorage = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(getStorageKey(key))
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

const saveToStorage = (key, value) => {
  try {
    localStorage.setItem(getStorageKey(key), JSON.stringify(value))
  } catch {
    // localStorage might be full or disabled
  }
}

// Group sessions by project path
function groupSessionsByProject(sessions, collapseState, sessionOrder) {
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

// Main App component
function App() {
  const [password, setPassword] = useState(() => localStorage.getItem('clarvis_password') || '')
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED)
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [pendingProject, setPendingProject] = useState(null) // Project for new session (before first query)
  const [messages, setMessages] = useState({}) // sessionId -> messages[]
  const [projects, setProjects] = useState([])
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [permissionRequests, setPermissionRequests] = useState({}) // sessionId -> request
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [statusData, setStatusData] = useState(null)
  const [errorToast, setErrorToast] = useState(null)
  const [collapseState, setCollapseState] = useState(() => loadFromStorage('collapse-state', {}))
  const [sessionOrder, setSessionOrder] = useState(() => loadFromStorage('session-order', {}))
  const [expandedCounts, setExpandedCounts] = useState(() => loadFromStorage('expanded-counts', {}))
  const [showArchived, setShowArchived] = useState(() => loadFromStorage('show-archived', {}))
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [settingsProject, setSettingsProject] = useState(null) // { name, path } when settings modal is open
  const [commands, setCommands] = useState([]) // Slash commands from SDK
  const [commandsError, setCommandsError] = useState(null) // Error fetching commands
  const [selectedSessions, setSelectedSessions] = useState(new Set()) // Selected session IDs for bulk actions
  const [lastSelectedSession, setLastSelectedSession] = useState(null) // For shift-click range selection
  const [bulkActionToast, setBulkActionToast] = useState(null) // { message, type }
  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)
  const seenMessageIds = useRef(new Map()) // sessionId -> Set of message uuids we've processed

  // Persist collapse state changes
  useEffect(() => {
    saveToStorage('collapse-state', collapseState)
  }, [collapseState])

  // Persist session order changes
  useEffect(() => {
    saveToStorage('session-order', sessionOrder)
  }, [sessionOrder])

  // Persist expanded counts changes
  useEffect(() => {
    saveToStorage('expanded-counts', expandedCounts)
  }, [expandedCounts])

  // Persist show archived state changes
  useEffect(() => {
    saveToStorage('show-archived', showArchived)
  }, [showArchived])

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
        // Subscribe to the session if we have one
        if (msg.sessionId) {
          wsRef.current?.send({ type: 'subscribe', sessionId: msg.sessionId })
        }
        break

      case 'session_created': {
        // SDK created a new session - add to list and set as active
        const newSession = {
          id: msg.sessionId,
          name: pendingProject?.name || 'Untitled',
          projectPath: msg.projectPath,
          status: 'running',
          lastActivity: Date.now()
        }
        setSessions(prev => [newSession, ...prev])
        setActiveSessionId(msg.sessionId)
        setPendingProject(null)
        // Move pending messages to the new session
        setMessages(prev => {
          const pendingMsgs = prev._pending || []
          const { _pending, ...rest } = prev
          return { ...rest, [msg.sessionId]: pendingMsgs }
        })
        wsRef.current?.send({ type: 'subscribe', sessionId: msg.sessionId })
        break
      }

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

      case 'session_archived':
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, archived: true } : s
        ))
        break

      case 'session_restored':
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, archived: false, lastActivity: Date.now() } : s
        ))
        break

      case 'bulk_result': {
        const { action, succeeded, failed } = msg
        setSelectedSessions(new Set()) // Clear selection after bulk action

        if (failed.length === 0) {
          setBulkActionToast({ message: `${succeeded.length} session${succeeded.length === 1 ? '' : 's'} ${action}d`, type: 'success' })
        } else if (succeeded.length === 0) {
          setBulkActionToast({ message: `Failed to ${action} ${failed.length} session${failed.length === 1 ? '' : 's'}`, type: 'error' })
        } else {
          setBulkActionToast({ message: `${succeeded.length} ${action}d, ${failed.length} failed`, type: 'warning' })
        }
        setTimeout(() => setBulkActionToast(null), 4000)

        // Update sessions state based on action
        if (action === 'archive') {
          setSessions(prev => prev.map(s => succeeded.includes(s.id) ? { ...s, archived: true } : s))
        } else if (action === 'unarchive') {
          setSessions(prev => prev.map(s => succeeded.includes(s.id) ? { ...s, archived: false, lastActivity: Date.now() } : s))
        } else if (action === 'delete') {
          setSessions(prev => prev.filter(s => !succeeded.includes(s.id)))
        } else if (action === 'stop') {
          setSessions(prev => prev.map(s => succeeded.includes(s.id) ? { ...s, status: 'idle' } : s))
        }
        break
      }

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

      case 'status':
        setStatusData(msg)
        break

      case 'commands':
        setCommands(msg.commands || [])
        setCommandsError(null)
        break

      case 'commands_error':
        setCommandsError(msg.error || 'Could not load commands')
        break

      case 'error':
        console.error('Server error:', msg.error)
        setErrorToast(msg.error)
        setTimeout(() => setErrorToast(null), 8000)
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

  // URL routing: handle hash-based session URLs
  useEffect(() => {
    const handleHashChange = () => {
      const hash = location.hash
      const sessionMatch = hash.match(/^#\/session\/(.+)$/)

      if (sessionMatch && sessions.length > 0) {
        const sessionId = sessionMatch[1]
        const session = sessions.find(s => s.id === sessionId)
        if (session) {
          if (activeSessionId !== sessionId) {
            setActiveSessionId(sessionId)
            setPendingProject(null)
            wsRef.current?.send({ type: 'get_history', sessionId, projectPath: session.projectPath })
            wsRef.current?.send({ type: 'get_commands' })
          }
        } else {
          // Session not found - redirect home with message
          history.replaceState(null, '', '#/')
          setErrorToast(`Session "${sessionId}" not found`)
        }
      }
    }

    // Handle initial load and hash changes
    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [sessions, activeSessionId])

  // Send prompt (accepts { text, images } from PromptInput)
  const sendPrompt = useCallback(({ text, images }) => {
    if (!wsRef.current) return

    // Determine target: existing session or pending new session
    const session = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null
    const targetProject = session?.projectPath || pendingProject?.path
    const targetName = session?.name || pendingProject?.name || 'Untitled'

    if (!targetProject) return

    // Build content blocks array (images first per Anthropic recommendation)
    const content = []

    for (const img of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType,
          data: img.dataUrl.split(',')[1] // Strip data:image/...;base64, prefix
        }
      })
    }

    if (text) {
      content.push({ type: 'text', text })
    }

    // Add user message locally for immediate feedback (marked as pending)
    const msgSessionId = activeSessionId || '_pending'
    setMessages(prev => ({
      ...prev,
      [msgSessionId]: [...(prev[msgSessionId] || []), {
        type: 'user',
        message: { content },
        _pending: true
      }]
    }))

    wsRef.current.send({
      type: 'query',
      sessionId: activeSessionId || undefined,
      options: {
        content,
        cwd: targetProject,
        name: targetName
      }
    })
  }, [activeSessionId, sessions, pendingProject])

  // Start new session - just prepare for first query, session created on send
  const startNewSession = useCallback((project) => {
    setActiveSessionId(null)
    setPendingProject(project)
    setMessages(prev => ({ ...prev, _pending: [] }))
    setShowNewSessionModal(false)
    setSidebarOpen(false)
    wsRef.current?.send({ type: 'get_commands' })
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

  // Archive session
  const archiveSession = useCallback((sessionId) => {
    wsRef.current?.send({ type: 'archive_session', sessionId })
  }, [])

  // Restore session
  const restoreSession = useCallback((sessionId, projectPath) => {
    wsRef.current?.send({ type: 'restore_session', sessionId, projectPath })
  }, [])

  // Stop a running session
  const stopSession = useCallback((sessionId) => {
    wsRef.current?.send({ type: 'interrupt', sessionId })
  }, [])

  // Pause a running session (can be resumed later)
  const pauseSession = useCallback((sessionId) => {
    wsRef.current?.send({ type: 'pause', sessionId })
  }, [])

  // Resume a paused session
  const resumeSession = useCallback((sessionId, projectPath) => {
    wsRef.current?.send({ type: 'resume', sessionId, projectPath })
  }, [])

  // Toggle session selection (handles shift-click range selection)
  const toggleSessionSelection = useCallback((sessionId, event, allVisibleSessions) => {
    setSelectedSessions(prev => {
      const next = new Set(prev)

      if (event?.shiftKey && lastSelectedSession && allVisibleSessions) {
        // Range selection: select all sessions between lastSelectedSession and sessionId
        const lastIdx = allVisibleSessions.indexOf(lastSelectedSession)
        const currentIdx = allVisibleSessions.indexOf(sessionId)

        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx)
          const end = Math.max(lastIdx, currentIdx)
          for (let i = start; i <= end; i++) {
            next.add(allVisibleSessions[i])
          }
        } else {
          next.add(sessionId)
        }
      } else if (event?.metaKey || event?.ctrlKey) {
        // Toggle individual selection
        if (next.has(sessionId)) {
          next.delete(sessionId)
        } else {
          next.add(sessionId)
        }
      } else {
        // Simple toggle
        if (next.has(sessionId)) {
          next.delete(sessionId)
        } else {
          next.add(sessionId)
        }
      }

      return next
    })
    setLastSelectedSession(sessionId)
  }, [lastSelectedSession])

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedSessions(new Set())
    setLastSelectedSession(null)
  }, [])

  // Bulk actions
  const bulkArchive = useCallback(() => {
    const ids = Array.from(selectedSessions)
    if (ids.length === 0) return
    wsRef.current?.send({ type: 'bulk_archive', sessionIds: ids })
  }, [selectedSessions])

  const bulkUnarchive = useCallback(() => {
    const ids = Array.from(selectedSessions)
    if (ids.length === 0) return
    wsRef.current?.send({ type: 'bulk_unarchive', sessionIds: ids })
  }, [selectedSessions])

  const bulkDelete = useCallback(() => {
    const ids = Array.from(selectedSessions)
    if (ids.length === 0) return
    if (confirm(`Delete ${ids.length} session${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) {
      wsRef.current?.send({ type: 'bulk_delete', sessionIds: ids })
    }
  }, [selectedSessions])

  const bulkStop = useCallback(() => {
    const ids = Array.from(selectedSessions)
    if (ids.length === 0) return
    wsRef.current?.send({ type: 'bulk_stop', sessionIds: ids })
  }, [selectedSessions])

  // Auth screen
  if (connectionState === ConnectionState.AUTH_ERROR || (!password && connectionState === ConnectionState.DISCONNECTED)) {
    return html`<${AuthScreen}
      onSubmit=${(p) => { setPassword(p); connect(p); }}
      error=${connectionState === ConnectionState.AUTH_ERROR}
    />`
  }

  const activeSession = sessions.find(s => s.id === activeSessionId)
  const activeMessages = activeSessionId ? (messages[activeSessionId] || []) : (messages._pending || [])
  const activePermission = permissionRequests[activeSessionId]

  // For display, use activeSession or a synthetic one from pendingProject
  const displaySession = activeSession || (pendingProject ? {
    id: '_pending',
    name: pendingProject.name,
    projectPath: pendingProject.path,
    status: 'idle'
  } : null)

  return html`
    <div class="app-layout">
      <${Sidebar}
        sessions=${sessions}
        activeSessionId=${activeSessionId}
        onSelectSession=${(id) => {
          const session = sessions.find(s => s.id === id)
          if (!session) return
          // Update URL for browser history navigation
          history.pushState(null, '', `#/session/${id}`)
          setActiveSessionId(id)
          setPendingProject(null)
          setSidebarOpen(false)
          // Request history from server (reads from SDK's JSONL files)
          wsRef.current?.send({ type: 'get_history', sessionId: id, projectPath: session.projectPath })
          // Fetch commands for this session (may vary by project/plugins)
          wsRef.current?.send({ type: 'get_commands' })
        }}
        onNewSession=${() => setShowNewSessionModal(true)}
        onQuickAddSession=${startNewSession}
        onDeleteSession=${deleteSession}
        onRenameSession=${renameSession}
        onArchiveSession=${archiveSession}
        onRestoreSession=${restoreSession}
        onStopSession=${stopSession}
        onPauseSession=${pauseSession}
        onResumeSession=${resumeSession}
        isOpen=${sidebarOpen}
        connectionState=${connectionState}
        onStatusClick=${() => {
          wsRef.current?.send({ type: 'get_status' })
          setShowStatusModal(true)
        }}
        collapseState=${collapseState}
        setCollapseState=${setCollapseState}
        sessionOrder=${sessionOrder}
        setSessionOrder=${setSessionOrder}
        expandedCounts=${expandedCounts}
        setExpandedCounts=${setExpandedCounts}
        showArchived=${showArchived}
        setShowArchived=${setShowArchived}
        onOpenSettings=${(project) => setSettingsProject(project)}
        selectedSessions=${selectedSessions}
        onToggleSelection=${toggleSessionSelection}
        onClearSelection=${clearSelection}
        onBulkArchive=${bulkArchive}
        onBulkUnarchive=${bulkUnarchive}
        onBulkDelete=${bulkDelete}
        onBulkStop=${bulkStop}
      />

      <div class="main-content">
        <${MainHeader}
          session=${displaySession}
          onMenuClick=${() => setSidebarOpen(!sidebarOpen)}
          connectionState=${connectionState}
          onRenameSession=${renameSession}
          onStopSession=${stopSession}
          onPauseSession=${pauseSession}
          onResumeSession=${resumeSession}
        />

        ${displaySession ? html`
          <${MessageStream}
            messages=${activeMessages}
            messagesEndRef=${messagesEndRef}
            isLoading=${displaySession.status === 'running' && !activePermission}
            onImageClick=${setLightboxSrc}
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
            disabled=${displaySession.status === 'running'}
            commands=${commands}
            commandsError=${commandsError}
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

      ${showStatusModal && html`
        <${StatusModal}
          status=${statusData}
          onClose=${() => setShowStatusModal(false)}
        />
      `}

      ${settingsProject && html`
        <${ProjectSettingsModal}
          project=${settingsProject}
          ws=${wsRef.current}
          onClose=${() => setSettingsProject(null)}
        />
      `}

      ${lightboxSrc && html`
        <${ImageLightbox}
          src=${lightboxSrc}
          onClose=${() => setLightboxSrc(null)}
        />
      `}

      ${errorToast && html`
        <div class="error-toast" onClick=${() => setErrorToast(null)}>
          <span class="error-toast-icon">⚠</span>
          <span class="error-toast-message">${errorToast}</span>
          <button class="error-toast-dismiss">×</button>
        </div>
      `}

      ${bulkActionToast && html`
        <div class="bulk-toast ${bulkActionToast.type}" onClick=${() => setBulkActionToast(null)}>
          <span class="bulk-toast-message">${bulkActionToast.message}</span>
          <button class="bulk-toast-dismiss">×</button>
        </div>
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
function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onQuickAddSession,
  onDeleteSession,
  onRenameSession,
  onArchiveSession,
  onRestoreSession,
  onStopSession,
  onPauseSession,
  onResumeSession,
  isOpen,
  connectionState,
  onStatusClick,
  collapseState,
  setCollapseState,
  sessionOrder,
  setSessionOrder,
  expandedCounts,
  setExpandedCounts,
  showArchived,
  setShowArchived,
  onOpenSettings,
  selectedSessions,
  onToggleSelection,
  onClearSelection,
  onBulkArchive,
  onBulkUnarchive,
  onBulkDelete,
  onBulkStop
}) {
  const projectGroups = groupSessionsByProject(sessions, collapseState, sessionOrder)

  // Compute which actions are applicable based on selected sessions
  const selectedSessionsList = Array.from(selectedSessions)
  const selectedSessionsData = selectedSessionsList.map(id => sessions.find(s => s.id === id)).filter(Boolean)
  const hasNonArchived = selectedSessionsData.some(s => !s.archived)
  const hasArchived = selectedSessionsData.some(s => s.archived)
  const hasRunning = selectedSessionsData.some(s => s.status === 'running' || s.status === 'waiting_permission')

  const toggleCollapse = (projectPath) => {
    setCollapseState(prev => ({
      ...prev,
      [projectPath]: !prev[projectPath]
    }))
  }

  const handleReorder = (projectPath, newOrder) => {
    setSessionOrder(prev => ({
      ...prev,
      [projectPath]: newOrder
    }))
  }

  const handleShowMore = (projectPath, currentCount, totalCount) => {
    setExpandedCounts(prev => ({
      ...prev,
      [projectPath]: Math.min((currentCount || 5) + 5, totalCount)
    }))
  }

  const handleShowAll = (projectPath, totalCount) => {
    setExpandedCounts(prev => ({
      ...prev,
      [projectPath]: totalCount
    }))
  }

  const handleToggleArchived = (projectPath) => {
    setShowArchived(prev => ({
      ...prev,
      [projectPath]: !prev[projectPath]
    }))
  }

  return html`
    <aside class="sidebar ${isOpen ? 'open' : ''}">
      <div class="sidebar-header">
        <h1>Clarvis</h1>
        <div class="connection-indicator ${connectionState}"></div>
      </div>
      <div class="sidebar-content">
        ${selectedSessions.size > 0 && html`
          <div class="selection-action-bar">
            <div class="selection-info">
              <span class="selection-count">${selectedSessions.size} selected</span>
              <button class="selection-clear" onClick=${onClearSelection} title="Clear selection">×</button>
            </div>
            <div class="selection-actions">
              ${hasNonArchived && html`
                <button class="selection-action-btn" onClick=${onBulkArchive}>Archive</button>
              `}
              ${hasArchived && html`
                <button class="selection-action-btn" onClick=${onBulkUnarchive}>Unarchive</button>
              `}
              ${hasRunning && html`
                <button class="selection-action-btn" onClick=${onBulkStop}>Stop</button>
              `}
              <button class="selection-action-btn danger" onClick=${onBulkDelete}>Delete</button>
            </div>
          </div>
        `}
        <button class="btn btn-primary" style="width: 100%; margin-bottom: 12px" onClick=${onNewSession}>
          + New Session
        </button>
        <div class="project-groups">
          ${projectGroups.map(group => html`
            <${ProjectGroup}
              key=${group.path}
              group=${group}
              activeSessionId=${activeSessionId}
              onSelectSession=${onSelectSession}
              onDeleteSession=${onDeleteSession}
              onRenameSession=${onRenameSession}
              onArchiveSession=${onArchiveSession}
              onRestoreSession=${onRestoreSession}
              onStopSession=${onStopSession}
              onPauseSession=${onPauseSession}
              onResumeSession=${onResumeSession}
              onToggleCollapse=${() => toggleCollapse(group.path)}
              onQuickAdd=${() => onQuickAddSession({ name: group.name, path: group.path })}
              onReorder=${(newOrder) => handleReorder(group.path, newOrder)}
              onOpenSettings=${() => onOpenSettings({ name: group.name, path: group.path })}
              expandedCount=${expandedCounts[group.path] || 5}
              onShowMore=${() => handleShowMore(group.path, expandedCounts[group.path], group.sessions.length)}
              onShowAll=${() => handleShowAll(group.path, group.sessions.length)}
              showArchived=${showArchived[group.path] || false}
              onToggleArchived=${() => handleToggleArchived(group.path)}
              selectedSessions=${selectedSessions}
              onToggleSelection=${onToggleSelection}
            />
          `)}
        </div>
      </div>
      <div class="sidebar-footer">
        <button class="btn btn-icon status-button" onClick=${onStatusClick} title="Server Status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </aside>
  `
}

// Project group component with collapsible header
function ProjectGroup({
  group,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onArchiveSession,
  onRestoreSession,
  onStopSession,
  onPauseSession,
  onResumeSession,
  onToggleCollapse,
  onQuickAdd,
  onReorder,
  onOpenSettings,
  expandedCount,
  onShowMore,
  onShowAll,
  showArchived,
  onToggleArchived,
  selectedSessions,
  onToggleSelection
}) {
  const [dragOverIdx, setDragOverIdx] = useState(null)
  const dragSourceRef = useRef(null)

  const handleDragStart = (e, sessionId, idx) => {
    dragSourceRef.current = { sessionId, idx }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', sessionId)
    e.target.classList.add('dragging')
  }

  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging')
    dragSourceRef.current = null
    setDragOverIdx(null)
  }

  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragSourceRef.current && dragSourceRef.current.idx !== idx) {
      setDragOverIdx(idx)
    }
  }

  const handleDragLeave = () => {
    setDragOverIdx(null)
  }

  const handleDrop = (e, dropIdx) => {
    e.preventDefault()
    setDragOverIdx(null)

    if (!dragSourceRef.current) return

    const { idx: sourceIdx } = dragSourceRef.current
    if (sourceIdx === dropIdx) return

    const sessionIds = group.sessions.map(s => s.id)
    const [moved] = sessionIds.splice(sourceIdx, 1)
    sessionIds.splice(dropIdx, 0, moved)
    onReorder(sessionIds)
  }

  const handleHeaderClick = (e) => {
    e.preventDefault()
    onToggleCollapse()
  }

  const totalActiveSessions = group.sessions.length
  const visibleSessions = group.sessions.slice(0, expandedCount)
  const remainingCount = totalActiveSessions - visibleSessions.length
  const archivedCount = group.archivedSessions.length

  // Build list of all visible session IDs for shift-click range selection
  const allVisibleSessionIds = [
    ...visibleSessions.map(s => s.id),
    ...(showArchived ? group.archivedSessions.map(s => s.id) : [])
  ]

  return html`
    <div class="project-group">
      <a
        href="#"
        role="button"
        class="project-header"
        onClick=${handleHeaderClick}
      >
        <span class="project-chevron ${group.collapsed ? '' : 'expanded'}">\u203a</span>
        <span class="project-name">${group.name}</span>
        <span class="project-count">${totalActiveSessions}</span>
        <button
          class="project-settings-btn"
          onClick=${(e) => { e.stopPropagation(); e.preventDefault(); onOpenSettings() }}
          title="Project settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <button
          class="project-add-btn"
          onClick=${(e) => { e.stopPropagation(); e.preventDefault(); onQuickAdd() }}
          title="New session in ${group.name}"
        >+</button>
      </a>
      ${!group.collapsed && html`
        <div class="project-sessions">
          ${visibleSessions.map((session, idx) => html`
            <div
              key=${session.id}
              class="session-drop-zone ${dragOverIdx === idx ? 'drag-over' : ''}"
              onDragOver=${(e) => handleDragOver(e, idx)}
              onDragLeave=${handleDragLeave}
              onDrop=${(e) => handleDrop(e, idx)}
            >
              <${SessionCard}
                session=${session}
                isActive=${session.id === activeSessionId}
                onClick=${() => onSelectSession(session.id)}
                onDelete=${() => onDeleteSession(session.id)}
                onRename=${(name) => onRenameSession(session.id, name)}
                onArchive=${() => onArchiveSession(session.id)}
                onStop=${() => onStopSession(session.id)}
                onPause=${() => onPauseSession(session.id)}
                onResume=${() => onResumeSession(session.id, group.path)}
                canArchive=${session.id !== activeSessionId}
                draggable=${true}
                onDragStart=${(e) => handleDragStart(e, session.id, idx)}
                onDragEnd=${handleDragEnd}
                isSelected=${selectedSessions.has(session.id)}
                onToggleSelection=${(e) => onToggleSelection(session.id, e, allVisibleSessionIds)}
              />
            </div>
          `)}
          ${remainingCount > 0 && html`
            <div class="session-pagination">
              <button class="show-more-link" onClick=${onShowMore}>
                Show more (${remainingCount})
              </button>
              <button class="show-all-link" onClick=${onShowAll}>
                Show all
              </button>
            </div>
          `}
          ${archivedCount > 0 && html`
            <button
              class="show-archived-toggle ${showArchived ? 'active' : ''}"
              onClick=${onToggleArchived}
            >
              ${showArchived ? 'Hide' : 'Show'} archived (${archivedCount})
            </button>
          `}
          ${showArchived && group.archivedSessions.map(session => html`
            <${SessionCard}
              key=${session.id}
              session=${session}
              isActive=${session.id === activeSessionId}
              isArchived=${true}
              onClick=${() => onSelectSession(session.id)}
              onDelete=${() => onDeleteSession(session.id)}
              onRename=${(name) => onRenameSession(session.id, name)}
              onRestore=${() => onRestoreSession(session.id, group.path)}
              isSelected=${selectedSessions.has(session.id)}
              onToggleSelection=${(e) => onToggleSelection(session.id, e, allVisibleSessionIds)}
            />
          `)}
        </div>
      `}
    </div>
  `
}

// Session card component
function SessionCard({
  session,
  isActive,
  isArchived,
  onClick,
  onDelete,
  onRename,
  onArchive,
  onRestore,
  onStop,
  onPause,
  onResume,
  canArchive,
  draggable,
  onDragStart,
  onDragEnd,
  isSelected,
  onToggleSelection
}) {
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(session.name)
  const menuRef = useRef(null)

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

  const handleContextMenu = (e) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
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

  const handleArchive = (e) => {
    e.stopPropagation()
    onArchive?.()
    setShowMenu(false)
  }

  const handleRestore = (e) => {
    e.stopPropagation()
    onRestore?.()
    setShowMenu(false)
  }

  const handleStop = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onStop?.()
  }

  const handlePause = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onPause?.()
  }

  const handleResume = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onResume?.()
  }

  const handleClick = (e) => {
    e.preventDefault()
    onClick()
  }

  const handleCheckboxClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onToggleSelection?.(e)
  }

  const isRunning = session.status === 'running' || session.status === 'waiting_permission'
  const isPaused = session.status === 'paused'

  return html`
    <a
      href=${`#/session/${session.id}`}
      class="session-card ${isActive ? 'active' : ''} ${isArchived ? 'archived' : ''} ${isSelected ? 'selected' : ''}"
      onClick=${handleClick}
      onContextMenu=${handleContextMenu}
      draggable=${draggable}
      onDragStart=${onDragStart}
      onDragEnd=${onDragEnd}
    >
      <div class="session-card-header">
        <input
          type="checkbox"
          class="session-checkbox"
          checked=${isSelected}
          onClick=${handleCheckboxClick}
          title="Select session"
        />
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
        ${isRunning && html`
          <button
            class="session-pause-btn"
            onClick=${handlePause}
            title="Pause session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          </button>
          <button
            class="session-stop-btn"
            onClick=${handleStop}
            title="Stop session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        `}
        ${isPaused && html`
          <button
            class="session-resume-btn"
            onClick=${handleResume}
            title="Resume session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          </button>
        `}
        ${!isArchived && !isRunning && !isPaused && canArchive && html`
          <button
            class="session-archive-btn"
            onClick=${handleArchive}
            title="Archive session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 8v13H3V8"></path>
              <path d="M1 3h22v5H1z"></path>
              <path d="M10 12h4"></path>
            </svg>
          </button>
        `}
        ${isArchived && html`
          <button
            class="session-restore-btn"
            onClick=${handleRestore}
            title="Restore session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
          </button>
        `}
        <span class="session-card-status ${session.status}"></span>
      </div>
      ${session.lastMessagePreview && html`
        <div class="session-card-preview">${session.lastMessagePreview}</div>
      `}
      ${showMenu && html`
        <div
          ref=${menuRef}
          class="session-menu"
          style="position: fixed; left: ${menuPos.x}px; top: ${menuPos.y}px;"
          onClick=${(e) => e.stopPropagation()}
        >
          ${isRunning && html`
            <button onClick=${(e) => { handlePause(e); setShowMenu(false); }}>Pause</button>
            <button onClick=${(e) => { handleStop(e); setShowMenu(false); }} class="danger">Stop</button>
          `}
          ${isPaused && html`
            <button onClick=${(e) => { handleResume(e); setShowMenu(false); }}>Resume</button>
          `}
          <button onClick=${() => { setIsRenaming(true); setShowMenu(false); }}>Rename</button>
          ${!isArchived && !isRunning && !isPaused && canArchive && html`
            <button onClick=${handleArchive}>Archive</button>
          `}
          ${isArchived && html`
            <button onClick=${handleRestore}>Restore</button>
          `}
          <button onClick=${handleDelete} class="danger">Delete</button>
          <button onClick=${() => setShowMenu(false)}>Cancel</button>
        </div>
      `}
    </a>
  `
}

// Main header component
function MainHeader({ session, onMenuClick, connectionState, onRenameSession, onStopSession, onPauseSession, onResumeSession }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef(null)

  const startEditing = () => {
    if (!session) return
    setEditValue(session.name)
    setIsEditing(true)
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSave = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== session.name) {
      onRenameSession(session.id, trimmed)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') setIsEditing(false)
  }

  const isRunning = session?.status === 'running' || session?.status === 'waiting_permission'
  const isPaused = session?.status === 'paused'

  return html`
    <header class="main-header">
      <button class="btn btn-icon" onClick=${onMenuClick} style="display: none">
        ☰
      </button>
      ${session && isEditing ? html`
        <input
          ref=${inputRef}
          type="text"
          class="main-header-title-input"
          value=${editValue}
          onInput=${(e) => setEditValue(e.target.value)}
          onBlur=${handleSave}
          onKeyDown=${handleKeyDown}
        />
      ` : html`
        <span
          class="main-header-title ${session ? 'editable' : ''}"
          onClick=${startEditing}
        >
          ${session?.name || 'No session selected'}
        </span>
      `}
      ${isRunning && session?.id && session.id !== '_pending' && html`
        <button
          class="btn btn-pause"
          onClick=${() => onPauseSession(session.id)}
          title="Pause this session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
          Pause
        </button>
        <button
          class="btn btn-stop"
          onClick=${() => onStopSession(session.id)}
          title="Stop this session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          Stop
        </button>
      `}
      ${isPaused && session?.id && html`
        <button
          class="btn btn-resume"
          onClick=${() => onResumeSession(session.id, session.projectPath)}
          title="Resume this session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
          Resume
        </button>
      `}
      <div class="connection-indicator ${connectionState}"></div>
    </header>
  `
}

// Message stream component
function MessageStream({ messages, messagesEndRef, isLoading, onImageClick }) {
  return html`
    <div class="message-stream">
      ${messages.map((msg, i) => html`
        <${Message} key=${i} message=${msg} onImageClick=${onImageClick} />
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
function Message({ message, onImageClick }) {
  if (message.type === 'user') {
    const content = message.message?.content || []
    const textBlocks = Array.isArray(content)
      ? content.filter(c => c.type === 'text')
      : []
    const imageBlocks = Array.isArray(content)
      ? content.filter(c => c.type === 'image')
      : []

    const text = textBlocks.map(c => c.text).join('\n')
    const hasContent = text || imageBlocks.length > 0

    if (!hasContent) return null

    return html`
      <div class="message message-user">
        ${imageBlocks.map((img, i) => {
          const src = img.source?.type === 'base64'
            ? 'data:' + img.source.media_type + ';base64,' + img.source.data
            : img.source?.url
          return html`<img
            key=${i}
            class="message-image"
            src=${src}
            alt="Attached image"
            onClick=${() => onImageClick?.(src)}
          />`
        })}
        ${text && html`<div>${text}</div>`}
      </div>
    `
  }

  if (message.type === 'assistant') {
    const content = message.message?.content
    // Only extract text, tool_use blocks will be handled below
    const text = Array.isArray(content)
      ? content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : content
    // Don't render empty assistant messages
    if (!text) return null
    return html`<div class="message message-assistant markdown-body" dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}></div>`
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
        return html`<div key=${i} class="message message-assistant markdown-body" dangerouslySetInnerHTML=${{ __html: renderMarkdown(block.text) }}></div>`
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

// Fuzzy match: check if all characters in query appear in order in target
function fuzzyMatch(query, target) {
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
function fuzzyScore(query, target) {
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

// Command autocomplete popover
function CommandAutocomplete({ commands, commandsError, filter, onSelect, onClose, highlightedIndex, setHighlightedIndex }) {
  const listRef = useRef(null)
  const safeCommands = commands || []

  // Filter and sort commands
  const filteredCommands = safeCommands
    .filter(cmd => fuzzyMatch(filter, cmd.name))
    .sort((a, b) => fuzzyScore(filter, a.name) - fuzzyScore(filter, b.name))

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const item = listRef.current.children[highlightedIndex]
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  // Error state
  if (commandsError) {
    return html`
      <div class="command-autocomplete" role="listbox" aria-label="Slash commands">
        <div class="command-autocomplete-error">${commandsError}</div>
      </div>
    `
  }

  // No matches state
  if (filteredCommands.length === 0) {
    return html`
      <div class="command-autocomplete" role="listbox" aria-label="Slash commands">
        <div class="command-autocomplete-empty">No matching commands</div>
      </div>
    `
  }

  return html`
    <div class="command-autocomplete" role="listbox" aria-label="Slash commands" ref=${listRef}>
      ${filteredCommands.map((cmd, i) => html`
        <div
          key=${cmd.name}
          class="command-item ${i === highlightedIndex ? 'highlighted' : ''}"
          role="option"
          aria-selected=${i === highlightedIndex}
          onClick=${() => onSelect(cmd)}
          onMouseEnter=${() => setHighlightedIndex(i)}
        >
          <span class="command-name">/${cmd.name}</span>
          ${cmd.argumentHint && html`
            <span class="command-args">${'<'}${cmd.argumentHint}${'>'}</span>
          `}
          <span class="command-description">${cmd.description}</span>
        </div>
      `)}
    </div>
  `
}

// Prompt input component
function PromptInput({ onSubmit, disabled, commands, commandsError }) {
  const [value, setValue] = useState('')
  const [images, setImages] = useState([]) // { id, dataUrl, mimeType }
  const [showCommands, setShowCommands] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const containerRef = useRef(null)

  const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  // Ensure commands is always an array
  const safeCommands = commands || []

  // Parse command from input - returns { commandFilter, isCommand, matchedCommand }
  const parseCommand = (text) => {
    if (!text.startsWith('/')) {
      return { commandFilter: '', isCommand: false, matchedCommand: null }
    }

    // Extract the command part (first word after /)
    const match = text.match(/^\/(\S*)/)
    const commandFilter = match ? match[1] : ''

    // Check if it exactly matches a command
    const matchedCommand = safeCommands.find(cmd => cmd.name === commandFilter)

    return { commandFilter, isCommand: true, matchedCommand }
  }

  const { commandFilter, isCommand, matchedCommand } = parseCommand(value)

  // Filter commands for autocomplete
  const filteredCommands = safeCommands.filter(cmd => fuzzyMatch(commandFilter, cmd.name))
    .sort((a, b) => fuzzyScore(commandFilter, a.name) - fuzzyScore(commandFilter, b.name))

  // Show autocomplete when typing slash command
  const shouldShowCommands = showCommands || (isCommand && filteredCommands.length > 0)

  // Close autocomplete when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowCommands(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [commandFilter])

  const addImageFile = async (file) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert('Unsupported image format. Please use JPEG, PNG, GIF, or WebP.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      alert('Image too large. Maximum size is 20MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      setImages(prev => [...prev, {
        id: Math.random().toString(36).slice(2),
        dataUrl: e.target.result,
        mimeType: file.type
      }])
    }
    reader.readAsDataURL(file)
  }

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await addImageFile(file)
      }
    }
  }

  const handleFileSelect = (e) => {
    const files = e.target.files
    if (!files) return
    for (const file of files) {
      addImageFile(file)
    }
    e.target.value = '' // Reset so same file can be selected again
  }

  const removeImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  const handleSubmit = () => {
    if ((value.trim() || images.length > 0) && !disabled) {
      onSubmit({ text: value.trim(), images })
      setValue('')
      setImages([])
      setShowCommands(false)
    }
  }

  const handleSelectCommand = (cmd) => {
    // Insert the command with a trailing space
    setValue(`/${cmd.name} `)
    setShowCommands(false)
    textareaRef.current?.focus()
  }

  const handleSlashButtonClick = () => {
    setShowCommands(!showCommands)
    setHighlightedIndex(0)
  }

  const handleInput = (e) => {
    const newValue = e.target.value
    const prevValue = value

    setValue(newValue)

    // Close autocomplete if backspace removed the leading /
    if (prevValue.startsWith('/') && !newValue.startsWith('/')) {
      setShowCommands(false)
    }
  }

  const handleKeyDown = (e) => {
    // Handle autocomplete navigation
    if (shouldShowCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex(i => Math.min(i + 1, filteredCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredCommands[highlightedIndex]) {
          e.preventDefault()
          handleSelectCommand(filteredCommands[highlightedIndex])
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowCommands(false)
        return
      }
    }

    // Normal submit on Enter (without shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleBlur = () => {
    // Delay to allow click on autocomplete item to register
    setTimeout(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setShowCommands(false)
      }
    }, 150)
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [value])

  const canSubmit = !disabled && (value.trim() || images.length > 0)

  // Compute overlay content for command highlighting
  const renderOverlay = () => {
    if (!matchedCommand) return null

    // Find where the command ends (first space after /command or end of string)
    const commandEndMatch = value.match(/^\/\S+/)
    if (!commandEndMatch) return null

    const commandPart = commandEndMatch[0]
    const restPart = value.slice(commandPart.length)

    return html`
      <div class="prompt-overlay" aria-hidden="true">
        <span class="command-highlight">${commandPart}</span>${restPart}
      </div>
    `
  }

  return html`
    <div class="prompt-container" ref=${containerRef}>
      ${images.length > 0 && html`
        <div class="image-preview-container">
          ${images.map(img => html`
            <div class="image-preview" key=${img.id}>
              <img src=${img.dataUrl} alt="Preview" />
              <button
                class="image-preview-remove"
                onClick=${() => removeImage(img.id)}
                title="Remove image"
              >×</button>
            </div>
          `)}
        </div>
      `}

      ${shouldShowCommands && html`
        <${CommandAutocomplete}
          commands=${safeCommands}
          commandsError=${commandsError}
          filter=${commandFilter}
          onSelect=${handleSelectCommand}
          onClose=${() => setShowCommands(false)}
          highlightedIndex=${highlightedIndex}
          setHighlightedIndex=${setHighlightedIndex}
        />
      `}

      <div class="prompt-input-wrapper">
        <input
          ref=${fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          style="display: none"
          onChange=${handleFileSelect}
        />
        <button
          class="btn btn-slash"
          onClick=${handleSlashButtonClick}
          disabled=${disabled}
          title="Slash commands"
          aria-expanded=${shouldShowCommands}
          aria-haspopup="listbox"
        >/</button>
        <button
          class="btn btn-attach"
          onClick=${() => fileInputRef.current?.click()}
          disabled=${disabled}
          title="Attach image"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <div class="prompt-input-container">
          ${renderOverlay()}
          <textarea
            ref=${textareaRef}
            class="prompt-input ${matchedCommand ? 'has-command' : ''}"
            value=${value}
            onInput=${handleInput}
            onKeyDown=${handleKeyDown}
            onPaste=${handlePaste}
            onBlur=${handleBlur}
            placeholder=${disabled ? 'Waiting for response...' : 'Type a message or paste an image...'}
            disabled=${disabled}
            rows="1"
            aria-autocomplete="list"
            aria-controls=${shouldShowCommands ? 'command-autocomplete' : undefined}
          ></textarea>
        </div>
        <button
          class="btn btn-primary"
          onClick=${handleSubmit}
          disabled=${!canSubmit}
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

// Status modal component
function StatusModal({ status, onClose }) {
  const formatBytes = (bytes) => {
    const gb = bytes / (1024 * 1024 * 1024)
    return gb.toFixed(1) + ' GB'
  }

  const authLabels = {
    oauth: 'Claude Pro/Max (OAuth)',
    api_key: 'API Key',
    none: 'Not configured'
  }

  return html`
    <div class="modal-overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal status-modal">
        <div class="modal-header">
          <h2 class="modal-title">Server Status</h2>
        </div>
        <div class="modal-body">
          ${status ? html`
            <div class="status-section">
              <h3>Authentication</h3>
              <div class="status-item">
                <span class="status-label">Method</span>
                <span class="status-value ${status.auth.type === 'none' ? 'status-warning' : 'status-ok'}">
                  ${authLabels[status.auth.type]}
                </span>
              </div>
              ${status.auth.type === 'none' && html`
                <p class="status-hint">
                  Run <code>fly ssh console</code> then <code>claude login</code> to authenticate.
                </p>
              `}
            </div>

            <div class="status-section">
              <h3>System</h3>
              <div class="status-item">
                <span class="status-label">Memory</span>
                <span class="status-value">
                  ${formatBytes(status.system.memoryUsed)} / ${formatBytes(status.system.memoryTotal)}
                  <span class="status-percent">(${status.system.memoryPercent}%)</span>
                </span>
              </div>
              <div class="status-bar">
                <div class="status-bar-fill" style="width: ${status.system.memoryPercent}%"></div>
              </div>
              <div class="status-item">
                <span class="status-label">CPU Cores</span>
                <span class="status-value">${status.system.cpuCount}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Load Average</span>
                <span class="status-value">${status.system.loadAvg.toFixed(2)}</span>
              </div>
            </div>
          ` : html`
            <p style="color: var(--text-secondary)">Loading...</p>
          `}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>
  `
}

// Project settings modal component
function ProjectSettingsModal({ project, ws, onClose }) {
  const CONFIG_TYPES = [
    { id: 'settings', label: 'Settings', path: '.claude/settings.json' },
    { id: 'local', label: 'Local Settings', path: '.claude/settings.local.json' },
    { id: 'mcp', label: 'MCP Servers', path: '.mcp.json' }
  ]

  const [activeTab, setActiveTab] = useState('settings')
  const [contents, setContents] = useState({}) // configType -> { content, exists, dirty }
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load all config files on mount
  useEffect(() => {
    if (!ws || !project) return

    const pending = new Set(CONFIG_TYPES.map(t => t.id))
    const loaded = {}

    const handleMessage = (msg) => {
      if (msg.type === 'config_content') {
        loaded[msg.configType] = {
          content: msg.content,
          exists: msg.exists,
          dirty: false
        }
        pending.delete(msg.configType)

        if (pending.size === 0) {
          setContents(loaded)
          setLoading(false)
        }
      }

      if (msg.type === 'config_saved') {
        setContents(prev => ({
          ...prev,
          [msg.configType]: { ...prev[msg.configType], dirty: false, exists: true }
        }))
        setSuccess('Saved successfully')
        setTimeout(() => setSuccess(null), 2000)
      }

      if (msg.type === 'config_error') {
        setError(msg.error)
      }
    }

    const removeListener = ws.addMessageListener(handleMessage)

    // Request all config files
    for (const type of CONFIG_TYPES) {
      ws.send({ type: 'read_config', projectPath: project.path, configType: type.id })
    }

    return removeListener
  }, [ws, project])

  const handleContentChange = (configType, newContent) => {
    setContents(prev => ({
      ...prev,
      [configType]: { ...prev[configType], content: newContent, dirty: true }
    }))
    setError(null)
    setSuccess(null)
  }

  const handleSave = () => {
    const currentContent = contents[activeTab]
    if (!currentContent?.dirty) return

    // Basic JSON validation before sending
    if (currentContent.content.trim()) {
      try {
        JSON.parse(currentContent.content)
      } catch (e) {
        setError(`Invalid JSON: ${e.message}`)
        return
      }
    }

    setError(null)
    ws.send({
      type: 'write_config',
      projectPath: project.path,
      configType: activeTab,
      content: currentContent.content || '{}'
    })
  }

  const activeConfig = CONFIG_TYPES.find(t => t.id === activeTab)
  const currentContent = contents[activeTab]

  return html`
    <div class="modal-overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal settings-modal">
        <div class="modal-header">
          <h2 class="modal-title">Settings: ${project.name}</h2>
        </div>
        <div class="modal-body">
          <div class="config-tabs">
            ${CONFIG_TYPES.map(type => html`
              <button
                key=${type.id}
                class="config-tab ${activeTab === type.id ? 'active' : ''}"
                onClick=${() => setActiveTab(type.id)}
              >
                <span class="config-tab-label">
                  ${type.label}
                  ${contents[type.id] && !contents[type.id].exists && html`
                    <span class="config-tab-new">(new)</span>
                  `}
                  ${contents[type.id]?.dirty && html`
                    <span style="color: var(--accent-warning)">*</span>
                  `}
                </span>
              </button>
            `)}
          </div>

          ${loading ? html`
            <p style="color: var(--text-secondary)">Loading...</p>
          ` : html`
            <div class="config-file-path">${activeConfig.path}</div>
            <div class="config-editor-container">
              <pre class="config-highlight"><code
                class="language-json"
                dangerouslySetInnerHTML=${{ __html: highlightJson(currentContent?.content || '') }}
              ></code></pre>
              <textarea
                class="config-editor"
                value=${currentContent?.content || ''}
                onInput=${(e) => handleContentChange(activeTab, e.target.value)}
                placeholder=${`{\n  // ${activeConfig.label} configuration\n}`}
                spellcheck="false"
              ></textarea>
            </div>
            ${error && html`<div class="config-error">${error}</div>`}
            ${success && html`<div class="config-success">${success}</div>`}
          `}
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-primary"
            onClick=${handleSave}
            disabled=${!currentContent?.dirty || loading}
          >
            Save
          </button>
          <button class="btn btn-secondary" onClick=${onClose}>Close</button>
        </div>
      </div>
    </div>
  `
}

// Image lightbox component
function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return html`
    <div class="lightbox-overlay" onClick=${onClose}>
      <img class="lightbox-image" src=${src} alt="Full size image" onClick=${(e) => e.stopPropagation()} />
    </div>
  `
}

// Render the app
render(html`<${App} />`, document.getElementById('app'))
