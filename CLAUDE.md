# CLAUDE.md

## Commands

```bash
./start.sh              # Start server (loads .env from parent dirs)
npm start               # Start server directly
npm run dev             # Start with --watch for auto-reload
./restart.sh            # Trigger restart (when using npm run dev)
./restart.sh kill       # Hard kill server process
npm test                # Run tests
```

## Architecture

```
server/
├── index.js          # HTTP + WebSocket server entry
├── config.js         # Config: CLI > env > file > defaults
├── auth.js           # Password management
├── ws-handler.js     # WebSocket message routing
├── sdk-bridge.js     # Thin wrapper around SDK query()
└── sessions.js       # Session index persistence

public/
├── index.html
├── css/main.css      # Dark theme with CSS custom properties
└── js/
    ├── app.js        # All Preact components + state
    ├── ws.js         # WebSocket client
    └── lib/          # Preact + htm (no CDN, no build step)
```

## WebSocket Protocol

Client sends: `query`, `resume`, `interrupt`, `permission`, `list_sessions`, `get_status`, `get_models`, `get_commands`

Server sends: `message` (SDK passthrough), `permission_request`, `status`, `sessions`, `models`, `commands`, `error`

### Query Message Format

The `query` message supports two formats for the prompt:

```javascript
// Text only (legacy)
{ type: 'query', sessionId, options: { prompt: 'string', cwd, name, resume } }

// With images (content array)
{ type: 'query', sessionId, options: { content: [...blocks], cwd, name, resume } }
```

Content blocks follow Anthropic's format:
```javascript
{ type: 'text', text: 'message' }
{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }
```

## Data & Auth

Session index: `~/.clarvis/sessions.json` (configurable via `CLARVIS_DATA_DIR`)

SDK credentials: `~/.claude/.credentials.json`

SDK checks OAuth first, then `ANTHROPIC_API_KEY` env var.

| Env Var | Purpose | Default |
|---------|---------|---------|
| `ANTHROPIC_API_KEY` | API authentication | - |
| `CLARVIS_PASSWORD` | WebSocket auth | auto-generated |
| `CLARVIS_PORT` | Server port | 3000 |
| `CLARVIS_PROJECTS_ROOT` | Projects directory | ~/projects |
| `CLARVIS_DATA_DIR` | Data storage path | ~/.clarvis |

## Frontend Patterns

All components live in `app.js` (Preact + htm, no JSX, no build step).

State lives in `App()`, passed down via props.

Adding a new modal: follow `NewSessionModal` or `StatusModal` pattern.

Adding a WS message type: add case in `handleMessage` switch.

## Key Design Decisions

- Frontend uses Preact + htm with no build step (ES modules from `public/js/lib/`)
- Server passes SDK options through with minimal transformation
- Clarvis only stores lightweight session index; actual conversation state lives in SDK
- Single password auth via query param on WebSocket connection
