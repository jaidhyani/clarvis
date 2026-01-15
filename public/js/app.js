import { h, render } from 'preact'
import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import htm from 'htm'
import { createWebSocket } from './ws.js'

// State and utilities
import { ConnectionState } from './state.js'
import { loadFromStorage, saveToStorage } from './utils.js'

// Components
import { Sidebar } from './components/sidebar.js'
import { MessageStream } from './components/messages.js'
import { NewSessionModal, StatusModal, ProjectSettingsModal, ImageLightbox } from './components/modals.js'
import { PromptInput } from './components/input.js'
import { AuthScreen, MainHeader, EmptyState, PermissionCard } from './components/common.js'

const html = htm.bind(h)

// Main App component
function App() {
  const [password, setPassword] = useState(() => localStorage.getItem('clarvis_password') || '')
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED)
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [pendingProject, setPendingProject] = useState(null)
  const [messages, setMessages] = useState({})
  const [projects, setProjects] = useState([])
  const [showNewSessionModal, setShowNewSessionModal] = useState(false)
  const [permissionRequests, setPermissionRequests] = useState({})
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [statusData, setStatusData] = useState(null)
  const [errorToast, setErrorToast] = useState(null)
  const [collapseState, setCollapseState] = useState(() => loadFromStorage('collapse-state', {}))
  const [sessionOrder, setSessionOrder] = useState(() => loadFromStorage('session-order', {}))
  const [expandedCounts, setExpandedCounts] = useState(() => loadFromStorage('expanded-counts', {}))
  const [showArchived, setShowArchived] = useState(() => loadFromStorage('show-archived', {}))
  const [lightboxSrc, setLightboxSrc] = useState(null)
  const [settingsProject, setSettingsProject] = useState(null)
  const [commands, setCommands] = useState([])
  const [commandsError, setCommandsError] = useState(null)
  const [selectedSessions, setSelectedSessions] = useState(new Set())
  const [lastSelectedSession, setLastSelectedSession] = useState(null)
  const [bulkActionToast, setBulkActionToast] = useState(null)
  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)
  const seenMessageIds = useRef(new Map())

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
        if (msg.sessionId) {
          wsRef.current?.send({ type: 'subscribe', sessionId: msg.sessionId })
        }
        break

      case 'session_created': {
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

        if (sdkMsg.type === 'system' && sdkMsg.subtype === 'init') {
          break
        }

        if (!seenMessageIds.current.has(sessionId)) {
          seenMessageIds.current.set(sessionId, new Set())
        }
        const seen = seenMessageIds.current.get(sessionId)

        if (sdkMsg.uuid && seen.has(sdkMsg.uuid)) {
          break
        }

        if (sdkMsg.uuid) {
          seen.add(sdkMsg.uuid)
        }

        setMessages(prev => {
          const sessionMsgs = prev[sessionId] || []

          if (sdkMsg.type === 'user' && sdkMsg.uuid) {
            const pendingIdx = sessionMsgs.findIndex(m => m._pending && m.type === 'user')
            if (pendingIdx !== -1) {
              const updated = [...sessionMsgs]
              updated[pendingIdx] = sdkMsg
              return { ...prev, [sessionId]: updated }
            }
          }

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
        setSelectedSessions(new Set())

        if (failed.length === 0) {
          setBulkActionToast({ message: `${succeeded.length} session${succeeded.length === 1 ? '' : 's'} ${action}d`, type: 'success' })
        } else if (succeeded.length === 0) {
          setBulkActionToast({ message: `Failed to ${action} ${failed.length} session${failed.length === 1 ? '' : 's'}`, type: 'error' })
        } else {
          setBulkActionToast({ message: `${succeeded.length} ${action}d, ${failed.length} failed`, type: 'warning' })
        }
        setTimeout(() => setBulkActionToast(null), 4000)

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
        const sessionId = msg.sessionId
        const history = msg.messages || []

        if (!seenMessageIds.current.has(sessionId)) {
          seenMessageIds.current.set(sessionId, new Set())
        }
        const seen = seenMessageIds.current.get(sessionId)

        for (const histMsg of history) {
          if (histMsg.uuid) {
            seen.add(histMsg.uuid)
          }
        }

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
          history.replaceState(null, '', '#/')
          setErrorToast(`Session "${sessionId}" not found`)
        }
      }
    }

    handleHashChange()
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [sessions, activeSessionId])

  // Send prompt
  const sendPrompt = useCallback(({ text, images }) => {
    if (!wsRef.current) return

    const session = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null
    const targetProject = session?.projectPath || pendingProject?.path
    const targetName = session?.name || pendingProject?.name || 'Untitled'

    if (!targetProject) return

    const content = []

    for (const img of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType,
          data: img.dataUrl.split(',')[1]
        }
      })
    }

    if (text) {
      content.push({ type: 'text', text })
    }

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

  // Start new session
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

  // Toggle session selection
  const toggleSessionSelection = useCallback((sessionId, event, allVisibleSessions) => {
    setSelectedSessions(prev => {
      const next = new Set(prev)

      if (event?.shiftKey && lastSelectedSession && allVisibleSessions) {
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
        if (next.has(sessionId)) {
          next.delete(sessionId)
        } else {
          next.add(sessionId)
        }
      } else {
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
          history.pushState(null, '', `#/session/${id}`)
          setActiveSessionId(id)
          setPendingProject(null)
          setSidebarOpen(false)
          wsRef.current?.send({ type: 'get_history', sessionId: id, projectPath: session.projectPath })
          wsRef.current?.send({ type: 'get_commands' })
        }}
        onNewSession=${() => setShowNewSessionModal(true)}
        onQuickAddSession=${startNewSession}
        onDeleteSession=${deleteSession}
        onRenameSession=${renameSession}
        onArchiveSession=${archiveSession}
        onRestoreSession=${restoreSession}
        onStopSession=${stopSession}
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

// Render the app
render(html`<${App} />`, document.getElementById('app'))
