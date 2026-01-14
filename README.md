# Clarvis

Web UI for the Claude Agent SDK. Manage multiple Claude Code sessions from your browser.

## Features

- **Multi-session**: Run multiple Claude Code sessions across different projects
- **Image support**: Paste images (Ctrl+V) or click attach to send images to Claude
- **Mobile-friendly**: Responsive dark theme, works on phones
- **No build step**: Preact + htm via ES modules, just run and go
- **Thin wrapper**: Server passes SDK options through unchanged
- **Permission handling**: Approve/deny tool permissions from the UI
- **Status monitoring**: View auth method and system resources from the UI

## Quick Start

```bash
npm install
npm start
```

Opens at `http://localhost:3000`. Password prints to console on startup.

## Configuration

| Setting | CLI | Env | Default |
|---------|-----|-----|---------|
| Port | `--port` | `CLARVIS_PORT` | `3000` |
| Projects root | `--projects-root` | `CLARVIS_PROJECTS_ROOT` | `~/projects` |
| Password | - | `CLARVIS_PASSWORD` | auto-generated |
| Data directory | - | `CLARVIS_DATA_DIR` | `~/.clarvis` |

Config file: `~/.clarvis/config.json`

## Authentication

Clarvis uses the Claude Agent SDK, which checks for credentials in this order:

1. **OAuth** (`~/.claude/.credentials.json`) - from `claude login`
2. **API Key** (`ANTHROPIC_API_KEY` env var)

For local development, just run `claude login` once. For cloud deployment, see below.

## Data Storage

| Path | Contents | Persists |
|------|----------|----------|
| `~/.clarvis/sessions.json` | Session index (names, project paths) | Yes |
| `~/.claude/` | SDK credentials and conversation history | Yes |

Both directories should be on persistent storage for production deployments.

## How It Works

```
Browser (Preact + htm)
        │
    WebSocket
        │
Server (Node.js) ──── SDK query() ──── Claude Agent SDK
```

The server is a thin bridge: it accepts SDK options from the frontend, streams messages back unchanged, and forwards permission requests.

## Usage

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Ctrl+V` | Paste image from clipboard |

### Session Management

- **New session**: Click "+ New Session" and select a project
- **Switch sessions**: Click any session in the sidebar
- **Rename/Delete**: Right-click a session for context menu

### Images

Attach images to your messages:
- **Paste**: Copy an image and press `Ctrl+V` in the text area
- **Upload**: Click the paperclip button to select files

Supported formats: JPEG, PNG, GIF, WebP (max 20MB each).

## Development

```bash
# Run with auto-restart on file changes
npm run dev

# Trigger restart (from another terminal)
npm run restart

# Stop server
npm run stop

# Run tests
npm test
```

## Requirements

- Node.js >= 20
- Claude authentication (either `claude login` or `ANTHROPIC_API_KEY`)

## Deploy to Fly.io

```bash
# Install flyctl if you haven't
curl -L https://fly.io/install.sh | sh

# Login to Fly
fly auth login

# Launch (creates app, prompts for settings)
fly launch

# Set a password (or let it auto-generate)
fly secrets set CLARVIS_PASSWORD=your-secure-password

# Create persistent volume for session data
fly volumes create clarvis_data --size 1 --region sea

# Deploy
fly deploy
```

Your app will be at `https://your-app.fly.dev`.

### Cloud Authentication

**Option A: Claude Pro/Max (OAuth)**
```bash
fly ssh console
claude login
# Opens a URL - authenticate in your browser
```

Credentials persist across restarts (stored on the volume at `/data/.claude`).

**Option B: API Key**
```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### Get Password

If you didn't set `CLARVIS_PASSWORD`, check the logs:
```bash
fly logs | grep Password
```

### Status

Click the gear icon in the sidebar to view auth method and system resources.
