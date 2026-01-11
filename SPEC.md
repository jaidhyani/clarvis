# Clarvis v2 Spec

## Overview

Clarvis is a web UI that wraps the Claude Agent SDK to provide multi-session Claude Code management with mobile-friendly design. The server is a thin WebSocket bridge that passes SDK options through and streams SDK messages back. The frontend handles rendering, session switching, and permission responses.

## Goals

- **Thin wrapper**: Server passes SDK options through, doesn't add business logic
- **Full SDK exposure**: Support all SDK features (streaming, hooks, MCP, plugins, CLAUDE.md)
- **Multi-session**: Manage multiple Claude Code sessions across projects
- **Mobile-friendly**: Responsive design, touch-friendly, works on phones
- **Minimal persistence**: Rely on SDK for session state, only track lightweight index

## Non-Goals

- REST API for programmatic use (redundant with SDK)
- Offline support / PWA
- Custom slash command editor
- Git/GitHub integration (roadmap item)
- Light theme (dark mode only for v1)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Preact + htm, no build step)                      │
│  - Renders SDK messages directly                            │
│  - Handles permission request UI                            │
│  - Session list with status indicators                      │
│  - Streaming token display                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                    WebSocket (bidirectional)
                              │
┌─────────────────────────────────────────────────────────────┐
│  Server (Node.js, minimal)                                  │
│  - Accepts SDK options from frontend, passes through        │
│  - Streams every SDKMessage to frontend unchanged           │
│  - Forwards permission requests, waits for response         │
│  - Tracks active queries for interrupt/abort                │
└─────────────────────────────────────────────────────────────┘
                              │
                        SDK query()
                              │
┌─────────────────────────────────────────────────────────────┐
│  @anthropic-ai/claude-agent-sdk                             │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

**Precedence**: CLI args > env vars > config file > defaults

| Setting | CLI | Env | Config key | Default |
|---------|-----|-----|------------|---------|
| Port | `--port` | `CLARVIS_PORT` | `port` | `3000` |
| Projects root | `--projects-root` | `CLARVIS_PROJECTS_ROOT` | `projectsRoot` | `~/projects` |

**Config file**: `~/.clarvis/config.json`

## Projects Model

- **Projects root**: A directory containing only project directories
- **Auto-discovery**: Any directory in projects root is a valid project
- **Project creation**: Just `mkdir`, everything else via Claude Code
- **Sessions**: Belong to a project, stored by SDK in `~/.claude/projects/`

## Data Storage

| File | Purpose |
|------|---------|
| `~/.clarvis/config.json` | Server configuration |
| `CLARVIS_PASSWORD` env var | Authentication password (or random generated on startup) |
| `~/.clarvis/sessions.json` | Lightweight session index (id, name, projectPath, lastActivity) |

## WebSocket Protocol

### Client → Server

```typescript
// Start new query
{ type: 'query', sessionId?: string, options: SDKOptions }

// Resume existing session
{ type: 'resume', sessionId: string }

// Interrupt running query
{ type: 'interrupt', sessionId: string }

// Respond to permission request
{ type: 'permission', requestId: string, decision: 'allow' | 'deny', updatedInput?: object }

// List sessions
{ type: 'list_sessions' }

// Get available models
{ type: 'get_models' }

// Get available commands
{ type: 'get_commands' }
```

### Server → Client

```typescript
// SDK message (passthrough)
{ type: 'message', sessionId: string, message: SDKMessage }

// Permission request
{ type: 'permission_request', sessionId: string, requestId: string, toolName: string, input: object }

// Session list
{ type: 'sessions', sessions: SessionInfo[] }

// Models list
{ type: 'models', models: ModelInfo[] }

// Commands list
{ type: 'commands', commands: SlashCommand[] }

// Error
{ type: 'error', sessionId?: string, error: string }
```

## Server State

```typescript
const activeQueries = new Map<string, {
  query: Query
  abortController: AbortController
  pendingPermissions: Map<string, (decision) => void>
}>()
```

## UI Components

| Component | Purpose |
|-----------|---------|
| `App` | Root, manages WebSocket connection and global state |
| `SessionList` | Sidebar with session cards, project grouping |
| `SessionCard` | Project name + last message preview + status indicator |
| `MessageStream` | Scrollable message list with virtualization |
| `Message` | Renders single SDKMessage based on type |
| `TokenStream` | Handles streaming partial messages |
| `ToolCall` | Collapsed tool invocation, expandable |
| `PermissionCard` | Permission request UI |
| `PromptInput` | Text input with send button |
| `ConnectionIndicator` | Subtle WebSocket status |

## Session States

```typescript
type SessionStatus = 'idle' | 'running' | 'waiting_permission' | 'error'
```

Visual indicators:
- Running: animated pulse
- Waiting permission: attention indicator
- Has updates: badge/dot

## File Structure

```
clarvis/
├── server/
│   ├── index.js          # Entry: HTTP server + WebSocket
│   ├── config.js         # Config loading (CLI > env > file)
│   ├── auth.js           # Token management
│   ├── ws-handler.js     # WebSocket message routing
│   ├── sdk-bridge.js     # Thin wrapper around query()
│   └── sessions.js       # Session index (id/name/project)
├── public/
│   ├── index.html
│   ├── css/
│   │   └── main.css      # Dark theme, CSS custom properties
│   └── js/
│       ├── app.js        # Root component + state
│       ├── ws.js         # WebSocket client
│       ├── components/
│       │   ├── session-list.js
│       │   ├── session-card.js
│       │   ├── message-stream.js
│       │   ├── message.js
│       │   ├── tool-call.js
│       │   ├── permission-card.js
│       │   ├── prompt-input.js
│       │   └── connection-indicator.js
│       └── lib/
│           ├── preact.module.js
│           └── htm.module.js
└── package.json
```

## SDK Options Passed Through

The frontend can specify any SDK option. Key ones:

```typescript
{
  prompt: string
  cwd: string                    // Project directory
  model?: string
  resume?: string                // Session ID to continue
  settingSources?: ['project']   // Load CLAUDE.md
  systemPrompt?: { type: 'preset', preset: 'claude_code' }
  includePartialMessages?: true  // Stream tokens
  mcpServers?: {}
  plugins?: []
  allowedTools?: []
  maxTurns?: number
  maxBudgetUsd?: number
}
```

## Build Phases

### Phase 1: Server Core
1. Config loading (CLI > env > file)
2. Auth token management
3. HTTP server serving static files
4. WebSocket server with auth
5. SDK bridge: query(), interrupt, permission callback
6. Session index CRUD

### Phase 2: Minimal UI
1. WebSocket client with reconnect
2. Single session message display
3. Prompt input
4. Basic permission handling

### Phase 3: Multi-Session
1. Session list sidebar
2. Session creation (select project)
3. Session switching
4. Status indicators

### Phase 4: Polish
1. Streaming token display
2. Tool call collapse/expand
3. Mobile responsive layout
4. Connection indicator

## Verification

1. Start server: `node server/index.js --port 3000`
2. Open `http://localhost:3000`
3. Create session for a test project
4. Send prompt, verify streaming response
5. Trigger a tool that needs permission, verify UI prompt
6. Test on mobile device (same network)
7. Test session resume after server restart
8. Test multiple concurrent sessions

## Acceptance Criteria

- [ ] Server starts and serves UI
- [ ] Can create session for a project in projects root
- [ ] Prompts stream responses token-by-token
- [ ] Permission requests show in UI, can approve/deny
- [ ] Can switch between multiple sessions
- [ ] Session persists across server restart (via SDK resume)
- [ ] Works on mobile browser
- [ ] CLAUDE.md loaded when settingSources includes 'project'
