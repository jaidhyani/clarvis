# Frontend

Preact + htm with no build step. All components in `js/app.js`.

## Component Hierarchy

```
App                        # Root - owns all state, renders modals/overlays
├── Sidebar                # Session list, project grouping
│   └── ProjectGroup       # Collapsible project with sessions
├── SessionHeader          # Active session name, status
├── MessageStream          # Scrollable message list
│   └── Message            # Single message (user/assistant/tool)
├── PermissionCard         # Allow/deny tool permissions
├── PromptInput            # Text input + image attachments
├── NewSessionModal        # Project picker overlay
├── StatusModal            # Server status overlay
├── ProjectSettingsModal   # Per-project config editor (settings.json, .mcp.json)
└── ImageLightbox          # Full-size image overlay
```

## Adding a Modal/Overlay

1. Add state in `App()`: `const [showMyModal, setShowMyModal] = useState(false)`
2. Create component with overlay pattern:
   ```javascript
   function MyModal({ onClose }) {
     return html`
       <div class="modal-overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
         <div class="modal">...</div>
       </div>
     `
   }
   ```
3. Render conditionally in App: `${showMyModal && html`<${MyModal} onClose=${...} />`}`
4. Add CSS: `.modal-overlay` handles backdrop, `.modal` handles content box

## Prop Drilling

Callbacks that need to reach nested components are passed through the hierarchy:
- `App` -> `MessageStream` -> `Message` (e.g., `onImageClick` for lightbox)

## Adding a WS Message Type

Add case in `handleMessage` switch in `App()`.
