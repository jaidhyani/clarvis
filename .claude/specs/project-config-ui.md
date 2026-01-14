# Project Config UI

## Overview

Add a settings modal to Clarvis that exposes Claude Code's native per-project configuration files for editing. The modal provides a JSON editor with syntax highlighting and schema validation, accessible via a gear icon in the project selector area. It reads/writes the standard `.claude/settings.json`, `.claude/settings.local.json`, and `.mcp.json` files directly.

## Goals

- Expose Claude Code's existing per-project config system through Clarvis UI
- Allow editing of shared settings, local settings, and MCP server config
- Provide JSON syntax highlighting and schema validation
- Create config files on first save if they don't exist

## Non-Goals

- Custom Clarvis-specific config storage (use native Claude Code files)
- GUI form fields for individual settings (JSON editor only for v1)
- Config merging logic in Clarvis (SDK handles precedence)
- Diff view or live preview of merged config

## Requirements

### Config Files

The modal exposes three files via tabs:

| Tab Label | File Path | Purpose |
|-----------|-----------|---------|
| Settings | `.claude/settings.json` | Shared project settings (committed to git) |
| Local Settings | `.claude/settings.local.json` | Personal overrides (gitignored) |
| MCP Servers | `.mcp.json` | Project MCP server configuration |

### UI Location

- Gear icon button next to the project name/path in the project selector area
- Opens a modal dialog with tabbed interface

### Editor Behavior

- Tabs for switching between the three config files
- JSON syntax highlighting in the editor
- If a file doesn't exist, show empty editor; create file on save
- Schema validation before saving (prevent invalid JSON and validate against Claude Code's expected structure)
- Clear error messages when validation fails

### File Operations

- Read config files from the project's working directory
- Write changes directly to disk when user saves
- Create parent directories (`.claude/`) if needed when saving

## Technical Approach

### Server Endpoints

Add two WebSocket message types:

1. `read_config` - Request: `{ type: 'read_config', projectPath, configType }` where configType is `'settings' | 'local' | 'mcp'`. Response includes file contents (empty string if file doesn't exist).

2. `write_config` - Request: `{ type: 'write_config', projectPath, configType, content }`. Server validates JSON, validates against schema, writes file, responds with success/error.

### Schema Validation

For settings files, validate against Claude Code's known structure:
- `permissions`: `{ allow: string[], deny: string[], ask: string[] }`
- `env`: `{ [key: string]: string }`
- `hooks`: object
- `model`: string

For MCP files, validate the mcpServers structure.

### Frontend Components

- `ProjectSettingsModal` - Modal container with tabs
- `ConfigEditor` - JSON editor with syntax highlighting (can use a simple `<textarea>` with Prism.js or similar, or a lightweight code editor)
- Tab state to track which file is being edited
- Dirty state tracking to warn about unsaved changes

### File Path Resolution

Config files are resolved relative to the project's working directory:
- `{projectPath}/.claude/settings.json`
- `{projectPath}/.claude/settings.local.json`
- `{projectPath}/.mcp.json`

## Open Questions

1. Which JSON syntax highlighting library to use? Options: Prism.js (lightweight), CodeMirror (full-featured), or simple regex-based highlighting.
2. Should we show a "file doesn't exist yet" indicator in the tab, or just show empty content?
3. Where to source the JSON schemas for validation - hardcode based on current Claude Code docs, or fetch dynamically?

## Acceptance Criteria

- [x] Gear icon appears next to project name in project selector
- [x] Clicking gear opens modal with three tabs (Settings, Local Settings, MCP Servers)
- [x] Each tab shows the file contents with JSON syntax highlighting
- [x] Empty editor shown for files that don't exist
- [x] Save button validates JSON syntax and schema before writing
- [x] Clear error message shown when validation fails
- [x] Files created on first save if they don't exist
- [x] `.claude/` directory created if needed
- [x] Changes are immediately reflected when Claude starts a new session
