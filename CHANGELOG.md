# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Multi-Session Selection**: Checkboxes on session cards with shift-click range selection
- **Bulk Actions**: Archive, unarchive, delete, and stop multiple sessions at once
- **`/lgtm` Command**: Slash command to update changelog, commit, and push
- **Beads Integration**: Issue tracking via beads with Claude Code hooks
- **Session Status**: Visual indicators for active (running/waiting) vs inactive sessions
- **Stop Button**: Header stop button appears when current session is running
- **Stop Button**: Sidebar stop icon replaces archive button for running sessions
- **Stop Button**: Context menu "Stop" option for running sessions
- **SDK Path Detection**: Auto-detect Claude Code binary (native install prioritized, falls back to PATH)

## [0.1.4] - 2026-01-14

### Added

- **Session List**: Show 5 sessions per project by default with "Show more" and "Show all" links
- **Session List**: Expansion state persists in localStorage per project
- **Archiving**: Right-click context menu with Archive option (active session cannot be archived)
- **Archiving**: Archive button on hover for quick access
- **Archiving**: "Show archived (N)" toggle to reveal archived sessions at 50% opacity
- **Archiving**: Restore action bumps session to top via file mtime update

### Fixed

- **Context Menu**: Now appears at click position instead of fixed location relative to element
- **Context Menu**: Dismisses when clicking outside

## [0.1.3] - 2026-01-14

### Added

- **Slash Commands**: "/" button in prompt input opens command autocomplete
- **Slash Commands**: Typing "/" triggers autocomplete with fuzzy matching
- **Slash Commands**: Arrow key navigation, Enter/Tab to select
- **Slash Commands**: Command highlighting in input when valid command recognized
- **Slash Commands**: ARIA accessibility attributes for screen readers

## [0.1.2] - 2026-01-14

### Added

- **Project Settings**: Gear icon on project headers opens config editor modal
- **Config Editor**: Edit `.claude/settings.json`, `.claude/settings.local.json`, and `.mcp.json` per project
- **Config Editor**: JSON syntax highlighting and schema validation
- **WebSocket**: `addMessageListener` method for component-level message subscriptions

## [0.1.1] - 2026-01-13

### Added

- **Sidebar**: Sessions now grouped under collapsible project headers
- **Sidebar**: Session count badge on each project
- **Sidebar**: Quick-add "+" button to create session directly in a project
- **Sidebar**: Drag-and-drop to reorder sessions within a project
- **Persistence**: Collapse state and session order saved to localStorage (namespaced by server)

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
