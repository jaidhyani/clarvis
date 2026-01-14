# UI Fixes: Sidebar Links, Input Width, Session Renaming

## Overview

Three UI improvements to Clarvis: (1) make sidebar project and session elements render as proper `<a>` links so browser extensions like Vimium can recognize them for keyboard navigation, (2) fix the input text box to fill available horizontal space on desktop, and (3) enable inline session renaming by clicking the title in the main header.

## Goals

- Sidebar sessions and projects are navigable via Vimium's link-following shortcuts
- Input textarea fills all space between left buttons (slash, attach) and right button (send)
- Users can rename the active session by clicking its title in the header

## Non-Goals

- Deep linking for modals, settings, or other transient UI states
- Custom keyboard shortcuts (relying on Vimium)
- URL routing for project groups (projects toggle collapse only)

## Requirements

### 1. Sidebar as Links

**Sessions:**
- Wrap session cards in `<a>` tags with `href` pointing to hash-based URLs: `#/session/{sessionId}`
- On click: prevent default, use existing JS navigation via `onSelectSession`
- Use `history.pushState` when navigating so browser back/forward works

**Projects:**
- Wrap project headers in `<a>` tags with `href="#"` (no actual URL navigation)
- On click: prevent default, toggle collapse (current behavior)
- Include `role="button"` for accessibility since it's not a true navigation link

**URL Handling:**
- On page load, parse `location.hash` for `#/session/{id}` pattern
- If session ID found and exists: select that session and fetch its history
- If session ID not found: redirect to `#/` (home) and show toast: "Session not found"
- URL updates in real-time as user navigates between sessions (pushState)
- Listen for `popstate` event to handle browser back/forward

### 2. Input Text Box Width

- Remove `max-width: 900px` from `.prompt-input-wrapper`
- Ensure `.prompt-input-container` (which wraps the textarea) uses `flex: 1` to fill remaining space
- The wrapper should span full width of `.main-content` minus padding
- Also remove `max-width: 900px` from `.image-preview-container` for consistency

### 3. Header Title Renaming

**Trigger:**
- Single click on the session title in `.main-header` enters edit mode
- Show subtle hover effect (underline or cursor change) to indicate editability

**Edit Mode:**
- Replace title `<span>` with `<input>` containing current session name
- Auto-focus and select all text
- Style to match header aesthetic (minimal borders)

**Save Behavior:**
- Save on blur or Enter key
- Cancel on Escape (revert to original name)
- Only send rename to server if name actually changed
- Use existing `renameSession` callback

**State:**
- Add `isEditingTitle` state to manage edit mode
- Only show edit mode when a session is active

## Technical Approach

### URL Routing (`app.js`)

```javascript
// Add to App component initialization
useEffect(() => {
  const handleHashChange = () => {
    const hash = location.hash
    const sessionMatch = hash.match(/^#\/session\/(.+)$/)

    if (sessionMatch) {
      const sessionId = sessionMatch[1]
      const session = sessions.find(s => s.id === sessionId)
      if (session) {
        setActiveSessionId(sessionId)
        wsRef.current?.send({ type: 'get_history', sessionId })
        wsRef.current?.send({ type: 'get_commands' })
      } else {
        // Session not found - redirect home with message
        location.hash = '#/'
        setErrorToast(`Session "${sessionId}" not found`)
      }
    }
  }

  // Initial load
  handleHashChange()

  // Listen for back/forward
  window.addEventListener('popstate', handleHashChange)
  return () => window.removeEventListener('popstate', handleHashChange)
}, [sessions])

// When selecting a session, update URL
const handleSelectSession = (id) => {
  history.pushState(null, '', `#/session/${id}`)
  setActiveSessionId(id)
  // ... existing logic
}
```

### Sidebar Links (`app.js`)

**SessionCard:**
```javascript
// Wrap in <a> tag
<a
  href=${`#/session/${session.id}`}
  class="session-card ${isActive ? 'active' : ''}"
  onClick=${(e) => { e.preventDefault(); onClick(); }}
  // ... rest of props
>
```

**ProjectGroup header:**
```javascript
<a
  href="#"
  role="button"
  class="project-header"
  onClick=${(e) => { e.preventDefault(); onToggleCollapse(); }}
>
```

### CSS Changes (`main.css`)

```css
/* Remove max-width constraints */
.prompt-input-wrapper {
  display: flex;
  gap: 8px;
  /* Remove: max-width: 900px; */
}

.image-preview-container {
  /* Remove: max-width: 900px; */
}

/* Session card as link */
a.session-card {
  display: block;
  text-decoration: none;
  color: inherit;
}

/* Project header as link */
a.project-header {
  text-decoration: none;
  color: inherit;
}

/* Header title editable hint */
.main-header-title {
  cursor: pointer;
}

.main-header-title:hover {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 4px;
}

.main-header-title-input {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--accent-primary);
  font-size: inherit;
  font-weight: inherit;
  color: var(--text-primary);
  padding: 0;
  outline: none;
}
```

### MainHeader Component Changes

```javascript
function MainHeader({ session, onMenuClick, connectionState, onRenameSession }) {
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

  return html`
    <header class="main-header">
      ...
      ${session && isEditing ? html`
        <input
          ref=${inputRef}
          class="main-header-title-input"
          value=${editValue}
          onInput=${(e) => setEditValue(e.target.value)}
          onBlur=${handleSave}
          onKeyDown=${handleKeyDown}
        />
      ` : html`
        <span
          class="main-header-title"
          onClick=${startEditing}
        >
          ${session?.name || 'No session selected'}
        </span>
      `}
      ...
    </header>
  `
}
```

## Open Questions

None - all requirements clarified during interview.

## Acceptance Criteria

1. **Sidebar Links:**
   - [ ] Session cards render as `<a>` tags with `href="#/session/{id}"`
   - [ ] Project headers render as `<a>` tags with `href="#"` and `role="button"`
   - [ ] Vimium can detect and navigate to both via `f` key
   - [ ] Clicking links uses JS navigation (no page reload)
   - [ ] Browser back/forward navigates session history
   - [ ] Direct URL navigation works (paste `#/session/abc` and it loads)
   - [ ] Invalid session URLs redirect to home with toast message

2. **Input Width:**
   - [ ] Input textarea fills horizontal space between slash/attach buttons and send button
   - [ ] No max-width constraint on input wrapper
   - [ ] Image preview container matches input width
   - [ ] Layout works on various viewport widths

3. **Header Title Rename:**
   - [ ] Clicking session title enters edit mode
   - [ ] Hover shows subtle underline hint
   - [ ] Input auto-focuses with text selected
   - [ ] Enter saves, Escape cancels, blur saves
   - [ ] Only sends rename if name changed
   - [ ] Title not clickable when no session selected
