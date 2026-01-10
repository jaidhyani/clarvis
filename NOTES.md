# Implementation Notes

## Decisions Made

### SDK Version
Using `@anthropic-ai/claude-agent-sdk@0.2.3` (latest as of implementation).

### Frontend Stack
- **Preact + htm**: Chose this over vanilla JS for cleaner component model
- **No build step**: Using ES modules directly from CDN downloads
- Libraries stored in `public/js/lib/` for offline use

### WebSocket Protocol
Implemented a comprehensive protocol covering:
- Session management (query, resume, interrupt)
- Permission handling (request/response flow)
- Metadata queries (models, commands, projects)

The protocol passes SDK options through with minimal transformation.

### Session Persistence
- Clarvis maintains a lightweight index in `~/.clarvis/sessions.json`
- Actual session state is managed by the SDK
- Sessions reference SDK session IDs for resume functionality

### Auth
- Single token approach for simplicity
- Token auto-generated on first run
- Stored with 0600 permissions

## SDK Integration Notes

### Message Types
The SDK yields these message types that we handle:
- `system` (subtype: `init`) - Session initialization
- `assistant` - Claude responses
- `stream_event` - Partial messages (when includePartialMessages: true)
- `result` - Query completion

### Permission Flow
1. SDK calls `canUseTool(toolName, input)`
2. We create a promise and store resolver in pendingPermissions map
3. Send permission_request to frontend
4. Wait for frontend response
5. Resolve promise with allow/deny

### Options Passed to SDK
```javascript
{
  prompt,
  cwd,
  model,
  resume,
  abortController,
  canUseTool,
  includePartialMessages: true,
  settingSources: ['project'],
  systemPrompt: { type: 'preset', preset: 'claude_code' }
}
```

## Testing Notes

### Manual Testing Checklist
- [ ] Server starts and displays token
- [ ] UI loads at localhost:3000
- [ ] Auth flow works (invalid token rejected)
- [ ] Projects list populated
- [ ] New session creation works
- [ ] Prompt submission works
- [ ] Messages stream correctly
- [ ] Permission requests appear
- [ ] Permission responses work
- [ ] Session switching works
- [ ] Server restart preserves sessions

### Known Issues
None yet.

## Future Improvements
- Streaming token display for real-time typing effect
- Better tool result formatting (syntax highlighting)
- Mobile swipe gestures for sidebar
- Push notifications for permission requests
