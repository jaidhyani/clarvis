# Clarvis

Web UI for the Claude Agent SDK. Manage multiple Claude Code sessions from your browser.

## Features

- **Multi-session**: Run multiple Claude Code sessions across different projects
- **Mobile-friendly**: Responsive dark theme, works on phones
- **No build step**: Preact + htm via ES modules, just run and go
- **Thin wrapper**: Server passes SDK options through unchanged
- **Permission handling**: Approve/deny tool permissions from the UI

## Quick Start

```bash
npm install
./start.sh
```

Opens at `http://localhost:3000`. Auth token prints to console on first run.

## Configuration

| Setting | CLI | Env | Default |
|---------|-----|-----|---------|
| Port | `--port` | `CLARVIS_PORT` | `3000` |
| Projects root | `--projects-root` | `CLARVIS_PROJECTS_ROOT` | `~/projects` |
| Password | - | `CLARVIS_PASSWORD` | auto-generated |

Config file: `~/.clarvis/config.json`

## How It Works

```
Browser (Preact + htm)
        │
    WebSocket
        │
Server (Node.js) ──── SDK query() ──── Claude Agent SDK
```

The server is a thin bridge: it accepts SDK options from the frontend, streams messages back unchanged, and forwards permission requests.

## Requirements

- Node.js >= 20
- `ANTHROPIC_API_KEY` environment variable
