# Changelog

## [2.0.0] - In Progress

### Phase 1: Server Core - COMPLETE

- **Config system**: CLI args > env vars > config file > defaults
  - `--port` / `CLARVIS_PORT` / `config.port` (default: 3000)
  - `--projects-root` / `CLARVIS_PROJECTS_ROOT` / `config.projectsRoot` (default: ~/projects)
  - Config file: `~/.clarvis/config.json`

- **Auth**: Password-based authentication
  - Set via `CLARVIS_PASSWORD` env var
  - Falls back to random generated password (printed to terminal)
  - Required for WebSocket connections

- **HTTP server**: Static file serving from `public/`

- **WebSocket server**: Full protocol implementation
  - `query` - Start new SDK query
  - `resume` - Resume existing session
  - `interrupt` - Abort running query
  - `permission` - Respond to permission requests
  - `list_sessions` / `list_projects`
  - `get_models` / `get_commands`
  - `create_project` / `delete_session`

- **SDK bridge**: Thin wrapper around `@anthropic-ai/claude-agent-sdk`
  - Passthrough options to SDK
  - Permission callback forwarding to UI
  - Message streaming to clients

- **Sessions**: Lightweight index in `~/.clarvis/sessions.json`
  - Auto-discovery of projects in projects root
  - Session state tracking (idle, running, waiting_permission, error)

### Phase 2: Minimal UI - COMPLETE

- **Preact + htm**: No build step required
- **WebSocket client**: Auto-reconnect with exponential backoff
- **Auth screen**: Password entry with error handling
- **Message stream**: Renders SDK messages
- **Tool calls**: Collapsible display
- **Permission cards**: Allow/deny UI
- **Prompt input**: Auto-resize textarea

### Phase 3: Multi-Session - COMPLETE

- **Session list sidebar**: Shows all sessions with status indicators
- **Session switching**: Click to switch active session
- **New session modal**: Project selection and creation
- **Status indicators**: Visual feedback for session states

### TODO: Phase 4 - Polish

- [ ] Streaming token display (partial messages)
- [ ] Improved tool call formatting
- [ ] Mobile responsive layout refinement
- [ ] Connection status improvements
