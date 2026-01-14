# Multi-Session Selection Spec

## Overview

Add the ability to select multiple sessions simultaneously for bulk operations. Users can select sessions via checkboxes (shown on hover) with shift/cmd-click support for range/multi-selection. A floating action bar appears at the top of the sidebar when sessions are selected, showing context-aware bulk actions (archive, unarchive, delete, stop).

## Goals

- Enable efficient bulk management of sessions (archive, delete, stop, unarchive)
- Provide intuitive selection UX with checkboxes and keyboard modifiers
- Show only applicable actions based on what's selected
- Handle partial failures gracefully with informative feedback

## Non-Goals

- "Select All" functionality
- Keyboard shortcuts for bulk actions
- Persisting selection across page reloads
- Drag-to-select or lasso selection

## Requirements

### Selection UI

- Checkbox appears on each session row on hover
- Checkbox remains visible when session is selected
- Selected sessions get a distinct background highlight (in addition to checkbox)
- Clicking checkbox toggles selection for that session
- Clicking elsewhere on the row opens the session (does not affect selection)
- All sessions are selectable, including the currently active session

### Multi-Select Behavior

- Shift-click: select range from last selected to clicked session
- Cmd/Ctrl-click: toggle individual session without affecting others
- Selection clears after any bulk action completes
- Selection is scoped to current view (active vs archived) - when switching views, selection clears

### Floating Action Bar

- Appears at top of sidebar when 1+ sessions are selected
- Shows instantly (no animation)
- Displays: selection count + clear button (e.g., "3 selected ✕")
- Text-only buttons for actions (no icons)
- Actions are context-aware based on selection:
  - "Archive" shown if any selected session is not archived
  - "Unarchive" shown if any selected session is archived
  - "Delete" always shown
  - "Stop" shown if any selected session is running

### Bulk Actions

- **Archive**: Archives all selected non-archived sessions, silently skips already-archived
- **Unarchive**: Restores all selected archived sessions, silently skips non-archived
- **Delete**: Shows confirmation dialog with count, then deletes all selected sessions
- **Stop**: Stops all running sessions in selection, silently skips already-stopped

### Error Handling

- If bulk action partially fails, show toast: "N succeeded, M failed"
- Toast includes option to retry failed operations
- Selection clears after action regardless of partial failure

### Delete Confirmation

- Always show confirmation dialog before bulk delete
- Dialog shows count of sessions to be deleted
- User must confirm to proceed

## Technical Approach

### Frontend State (`public/js/app.js`)

1. Add state:
   ```javascript
   selectedSessions: new Set()  // Set of session IDs
   lastSelectedSession: null    // For shift-click range selection
   ```

2. Selection functions:
   - `toggleSessionSelection(sessionId, event)` - handles click/shift/cmd logic
   - `clearSelection()` - empties set
   - `getSelectedSessionsInfo()` - returns array of session objects for selected IDs

### Components

1. **SelectionActionBar** - new component:
   - Renders at top of sidebar when `selectedSessions.size > 0`
   - Shows count with clear button
   - Renders context-aware action buttons
   - Calls bulk action handlers

2. **SessionCard** modifications:
   - Add checkbox element (visible on hover or when selected)
   - Add `selected` class for background highlight
   - Handle checkbox click vs row click separately

3. **Sidebar/ProjectGroup** modifications:
   - Pass selection state down to SessionCard
   - Handle clearing selection on view switch

### Backend Changes (`server/ws-handler.js`)

1. Add `bulk_archive` message:
   - Takes array of session IDs
   - Returns `{ succeeded: [...ids], failed: [...ids] }`

2. Add `bulk_unarchive` message:
   - Same structure as bulk_archive

3. Add `bulk_delete` message:
   - Same structure

4. Add `bulk_stop` message:
   - Same structure, stops running sessions

### CSS Changes (`public/css/main.css`)

1. `.session-checkbox` - positioned in session row, hidden by default
2. `.session-card:hover .session-checkbox` - visible on hover
3. `.session-card.selected .session-checkbox` - visible when selected
4. `.session-card.selected` - background highlight color
5. `.selection-action-bar` - styling for floating bar at top of sidebar
6. `.selection-count` - count display with clear button
7. `.selection-action-btn` - text button styling

### WebSocket Protocol

New message types:

```javascript
// Client -> Server
{ type: 'bulk_archive', sessionIds: [...] }
{ type: 'bulk_unarchive', sessionIds: [...] }
{ type: 'bulk_delete', sessionIds: [...] }
{ type: 'bulk_stop', sessionIds: [...] }

// Server -> Client
{ type: 'bulk_result', action: 'archive|unarchive|delete|stop', succeeded: [...], failed: [...] }
```

## Open Questions

None - all clarified in interview.

## Acceptance Criteria

- [ ] Checkbox appears on session row hover
- [ ] Checkbox stays visible when session is selected
- [ ] Selected sessions have distinct background highlight
- [ ] Shift-click selects range of sessions
- [ ] Cmd/Ctrl-click toggles individual session
- [ ] Floating action bar appears at top of sidebar when sessions selected
- [ ] Action bar shows "N selected ✕" with working clear button
- [ ] Action bar shows only applicable actions based on selection state
- [ ] "Archive" button archives all selected non-archived sessions
- [ ] "Unarchive" button restores all selected archived sessions
- [ ] "Delete" button shows confirmation dialog with count
- [ ] "Stop" button stops all running sessions in selection
- [ ] Partial failures show toast with success/failure counts
- [ ] Selection clears after bulk action completes
- [ ] Clicking session row (not checkbox) opens session without affecting selection
