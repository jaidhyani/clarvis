# CLAUDE.md

## Commands

```bash
npm start               # Start server (loads .env from parent dirs)
npm run dev             # Start with --watch for auto-reload
npm run restart         # Trigger restart (when using npm run dev)
npm run stop            # Kill server process
npm test                # Run tests
```

### Server Scripts

The server uses PID-based process management via `scripts/start.js` and `scripts/restart.js`:

- **start.js**: Launches `server/index.js`, writes PID to `~/.clarvis/clarvis.pid`, auto-cleans on shutdown
- **restart.js**: Reads PID file to send signals (`kill` to stop, touch file to trigger `--watch` restart)

If the server won't start due to port conflict:
```bash
lsof -ti:3000 | xargs -r kill -9   # Force kill whatever is on port 3000
npm start
```

## Architecture

```
scripts/
├── start.js          # Cross-platform server launcher with PID tracking
└── restart.js        # Cross-platform restart/stop via PID file

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

PID file: `~/.clarvis/clarvis.pid` (auto-cleaned on shutdown)

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

See `public/CLAUDE.md` for component hierarchy and patterns.

## Key Design Decisions

- Frontend uses Preact + htm with no build step (ES modules from `public/js/lib/`)
- Server passes SDK options through with minimal transformation
- Clarvis only stores lightweight session index; actual conversation state lives in SDK
- Single password auth via query param on WebSocket connection

## Releasing

1. Add changes under `[Unreleased]` in CHANGELOG.md as you work
2. When releasing, move unreleased items to a new version heading with date
3. Update version in `package.json`
4. Commit: `git commit -am "Release vX.Y.Z"`
5. Tag: `git tag -a vX.Y.Z -m "Release description"`
