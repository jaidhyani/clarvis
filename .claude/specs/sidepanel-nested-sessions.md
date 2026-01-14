# Sidepanel: Sessions Nested Under Projects

## Overview

Update the Clarvis sidebar to display sessions grouped under their parent projects, using an indented list style with collapsible project headers. Projects are derived from session `projectPath` values (folder name extracted from path), sorted by most recent activity. Sessions maintain their existing sort order within projects, with user-reorderable positions via drag-and-drop.

## Goals

- Group sessions visually under their parent project in the sidebar
- Show project name (folder name) with session count badge
- Allow collapsing/expanding projects with persisted state
- Enable drag-to-reorder sessions within a project (order persisted in localStorage)
- Add quick "+" button on project headers to create sessions in that project

## Non-Goals

- First-class project storage with custom names/metadata (projects remain filesystem-derived)
- Cross-project session dragging (sessions stay in their original project)
- Virtual scrolling or pagination (expected scale is <50 projects)
- Keyboard navigation shortcuts (may add later)
- Sessions in subdirectories grouping under parent (exact path match only)

## Requirements

### Project Display
- Extract folder name from session's `projectPath` as display name
- Show session count next to project name (e.g., "clarvis (3)")
- Sort projects by most recent session activity (project with newest session first)
- Always show project grouping even for single-session projects

### Collapse/Expand
- Chevron icon: `>` when collapsed, `v` when expanded
- Clicking project header toggles collapse state
- Collapse state persisted in localStorage with namespaced key (include server URL)
- Do NOT auto-expand project containing active session on load (respect persisted state only)

### Session Ordering
- Sessions within project keep existing sort order by default
- User can drag-and-drop to reorder sessions within a project
- Custom order persisted in localStorage (namespaced key)
- Visual feedback during drag: ghost element + drop indicator line

### Quick Add
- "+" button appears on project header (on hover or always visible)
- Clicking "+" creates new session in that project directly
- Keep existing "New Session" modal flow as alternative

### Visual Style
- Indented list: sessions indented under project header
- Preserve existing session selection behavior exactly
- Maintain current hover/active states for sessions

## Technical Approach

### Data Flow
1. Sessions fetched from server already contain `projectPath`
2. Group sessions by `projectPath` client-side in `app.js`
3. Extract folder name: `path.split('/').pop()` or similar
4. Sort grouped projects by max `lastActivity` of their sessions

### State Management (app.js)
```javascript
// New state
const [collapseState, setCollapseState] = useState(() =>
  loadFromStorage('clarvis-collapse-state-' + serverUrl, {})
)
const [sessionOrder, setSessionOrder] = useState(() =>
  loadFromStorage('clarvis-session-order-' + serverUrl, {})
)

// Persist on change
useEffect(() => saveToStorage(key, collapseState), [collapseState])
useEffect(() => saveToStorage(key, sessionOrder), [sessionOrder])
```

### Grouping Logic
```javascript
function groupSessionsByProject(sessions) {
  const groups = {}
  for (const session of sessions) {
    const projectName = session.projectPath.split('/').pop()
    if (!groups[projectName]) {
      groups[projectName] = { path: session.projectPath, sessions: [], latestActivity: 0 }
    }
    groups[projectName].sessions.push(session)
    groups[projectName].latestActivity = Math.max(
      groups[projectName].latestActivity,
      session.lastActivity
    )
  }
  // Sort projects by latestActivity desc, sessions by custom order or default
  return Object.values(groups).sort((a, b) => b.latestActivity - a.latestActivity)
}
```

### Drag-and-Drop
- Use HTML5 drag/drop API (no external library)
- `draggable="true"` on session items
- Track drag source and drop target
- Update `sessionOrder[projectPath]` array on drop
- CSS classes for ghost element (opacity) and drop indicator (border/line)

### localStorage Keys
- `clarvis-collapse-state-{serverUrl}`: `{ [projectPath]: boolean }`
- `clarvis-session-order-{serverUrl}`: `{ [projectPath]: [sessionId, ...] }`

### Component Structure
```
Sidebar
└── ProjectGroup (for each project)
    ├── ProjectHeader (name, count, chevron, + button)
    └── SessionList (if expanded)
        └── SessionItem (existing, now draggable)
```

## Open Questions

1. Should the "+" quick-add button be always visible or only on hover?
2. Edge case: What if two different paths end with same folder name? (e.g., `~/work/api` and `~/personal/api`) - show full path disambiguation?

## Acceptance Criteria

- [ ] Sessions are visually grouped under project headers in sidebar
- [ ] Project headers show folder name and session count
- [ ] Projects sorted by most recent session activity
- [ ] Clicking project header expands/collapses with chevron indicator
- [ ] Collapse state persists across page reloads (localStorage)
- [ ] Sessions can be dragged to reorder within their project
- [ ] Drag shows ghost element + drop indicator line
- [ ] Session order persists across page reloads (localStorage)
- [ ] "+" button on project header creates session in that project
- [ ] Existing session selection behavior unchanged
- [ ] localStorage keys namespaced with server URL
