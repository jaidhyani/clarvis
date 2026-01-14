# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2025-01-13

### Added

- **Server**: HTTP + WebSocket server with password authentication
- **Config**: CLI args > env vars > config file > defaults hierarchy
- **SDK integration**: Thin wrapper around `@anthropic-ai/claude-agent-sdk`
- **Session management**: Multi-session support with persistent index
- **Project discovery**: Auto-discovery of projects in configurable root directory
- **Frontend**: Preact + htm UI with no build step
- **Message rendering**: Markdown support with syntax highlighting for code blocks
- **Tool calls**: Collapsible display with input/output
- **Permission UI**: Allow/deny cards for SDK permission requests
- **Image support**: Upload and paste images into prompts
- **Auto-reconnect**: WebSocket client with exponential backoff
- **Status endpoint**: Server health check at `/status`
- **Cross-platform scripts**: Node.js start/restart/stop via PID file
