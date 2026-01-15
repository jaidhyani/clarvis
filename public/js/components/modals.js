import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import htm from 'htm'
import { highlightJson } from '../utils.js'

const html = htm.bind(h)

// New session modal component
export function NewSessionModal({ projects, onSelect, onClose, onCreateProject }) {
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
export function StatusModal({ status, onClose }) {
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
export function ProjectSettingsModal({ project, ws, onClose }) {
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
export function ImageLightbox({ src, onClose }) {
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
