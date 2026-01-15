import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import htm from 'htm'
import { groupSessionsByProject } from '../utils.js'

const html = htm.bind(h)

// Session card component
export function SessionCard({
  session,
  isActive,
  isArchived,
  onClick,
  onDelete,
  onRename,
  onArchive,
  onRestore,
  onStop,
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
            class="session-stop-btn"
            onClick=${handleStop}
            title="Stop session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        `}
        ${!isArchived && !isRunning && canArchive && html`
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
            <button onClick=${(e) => { handleStop(e); setShowMenu(false); }} class="danger">Stop</button>
          `}
          <button onClick=${() => { setIsRenaming(true); setShowMenu(false); }}>Rename</button>
          ${!isArchived && !isRunning && canArchive && html`
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

// Project group component with collapsible header
export function ProjectGroup({
  group,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onArchiveSession,
  onRestoreSession,
  onStopSession,
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

// Sidebar component
export function Sidebar({
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
