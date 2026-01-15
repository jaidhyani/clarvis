import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import htm from 'htm'

const html = htm.bind(h)

// Auth screen component
export function AuthScreen({ onSubmit, error }) {
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

// Main header component
export function MainHeader({ session, onMenuClick, connectionState, onRenameSession, onStopSession }) {
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
      <div class="connection-indicator ${connectionState}"></div>
    </header>
  `
}

// Empty state component
export function EmptyState({ onNewSession }) {
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

// Permission card component
export function PermissionCard({ request, onAllow, onDeny }) {
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
