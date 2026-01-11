# CLAUDE.md

## Commands

```bash
./start.sh              # Start server (loads .env from parent dirs)
npm start               # Start server directly
npm run dev             # Start with --watch for auto-reload
npm test                # Run tests
```

## Architecture

```
server/
├── index.js          # HTTP + WebSocket server entry
├── config.js         # Config: CLI > env > file > defaults
├── auth.js           # Token management
├── ws-handler.js     # WebSocket message routing
├── sdk-bridge.js     # Thin wrapper around SDK query()
└── sessions.js       # Session index persistence

public/
├── index.html
├── css/main.css      # Dark theme with CSS custom properties
└── js/
    ├── app.js        # Root component + state
    ├── ws.js         # WebSocket client
    ├── components/   # Preact components
    └── lib/          # Preact + htm (no CDN)
```

## WebSocket Protocol

Client sends: `query`, `resume`, `interrupt`, `permission`, `list_sessions`, `get_models`, `get_commands`

Server sends: `message` (SDK passthrough), `permission_request`, `sessions`, `models`, `commands`, `error`

## Key Design Decisions

- Frontend uses Preact + htm with no build step (ES modules from `public/js/lib/`)
- Server passes SDK options through with minimal transformation
- Clarvis only stores lightweight session index; actual state lives in SDK
- Single auth token stored at `~/.clarvis/token` with 0600 permissions
