# Session List Improvements Spec

## Overview

Improve the Clarvis session sidebar to handle large numbers of sessions gracefully. Sessions will be sorted by last activity (file mtime), limited to 5 visible by default with "show more/all" expansion, and support archiving to hide old sessions without deleting them.

## Goals

- Order sessions by last activity (most recent first)
- Reduce visual clutter by showing only 5 sessions per project by default
- Allow archiving sessions to hide them from the main list
- Provide easy restoration of archived sessions

## Non-Goals

- Bulk archive actions (future enhancement)
- Deleting archived sessions differently than regular sessions
- Changing how sessions are stored in the SDK

## Requirements

### Sorting

- Sort sessions by file mtime (descending - most recent first)
- When a session is restored from archive, touch its SDK file to bump it to top

### Default Limit & Expansion

- Show 5 sessions per project by default when expanded
- "Show more" link loads 5 additional sessions per click
- "Show all" link reveals all remaining sessions
- Expansion state persists in localStorage per project
- Resets to 5 on page reload only if not explicitly expanded

### Archiving

- Store archive state in `session-meta.json`: `{ uuid: { name?, archived: true } }`
- Archive action available via:
  - Right-click context menu (alongside Rename/Delete)
  - Hover action (archive icon appears)
- No confirmation needed - instant action
- Cannot archive the currently active session (disable/hide the action)

### Archive UI

- Per-project "show archived" toggle link below the session list
- When toggled on, archived sessions appear separately (not counted against the 5-session limit)
- Archived sessions displayed with dimmed/muted opacity (50%)
- "Restore" action in context menu and on hover
- When archive toggle is hidden again, keeps same expansion level for active sessions

### Session Count

- Project header count (e.g., "test-project 30") shows only active (non-archived) sessions

## Technical Approach

### Backend Changes (`server/sessions.js`)

1. `discoverSessions()` already returns `lastModified` from file stat - no changes needed
2. `setSessionMeta(id, { archived: true })` - existing function works
3. Add `touchSessionFile(sessionId, projectPath)` - updates file mtime for restore-to-top

### Backend Changes (`server/ws-handler.js`)

1. `list_sessions` - filter out archived sessions by default, or include based on request param
2. Add `archive_session` message handler - calls `setSessionMeta(id, { archived: true })`
3. Add `restore_session` message handler - calls `setSessionMeta(id, { archived: false })` + `touchSessionFile()`

### Frontend Changes (`public/js/app.js`)

1. **State additions:**
   - `expandedCounts: { [projectPath]: number }` - how many sessions to show per project
   - `showArchived: { [projectPath]: boolean }` - archive toggle state per project

2. **ProjectGroup component:**
   - Slice sessions to `expandedCounts[path] || 5`
   - Render "Show more" / "Show all" links when more sessions exist
   - Render "Show archived (N)" toggle when archived sessions exist
   - When showing archived, render them in separate section with dimmed styling

3. **SessionCard component:**
   - Add archive/restore hover action
   - Add archive/restore to context menu
   - Disable archive action if session is active

4. **localStorage persistence:**
   - Key: `clarvis-expanded-counts-{serverUrl}`
   - Key: `clarvis-show-archived-{serverUrl}`

### CSS Changes (`public/css/main.css`)

1. `.session-card.archived { opacity: 0.5; }`
2. `.session-archive-btn` - hover action styling
3. `.show-more-link`, `.show-all-link` - expansion controls
4. `.show-archived-toggle` - toggle link styling

## Open Questions

None - all clarified in interview.

## Acceptance Criteria

- [ ] Sessions sorted by mtime (most recent first) within each project
- [ ] Only 5 sessions shown by default per project
- [ ] "Show more" adds 5 more sessions per click
- [ ] "Show all" reveals remaining sessions
- [ ] Expansion state persists in localStorage
- [ ] Can archive a session via right-click menu
- [ ] Can archive a session via hover action
- [ ] Cannot archive the active session (action disabled)
- [ ] Archived sessions hidden by default
- [ ] "Show archived (N)" toggle appears when archived sessions exist
- [ ] Archived sessions appear dimmed when shown
- [ ] Can restore archived session via right-click menu
- [ ] Restored session appears at top of list
- [ ] Project header count excludes archived sessions
