# Slash Commands Feature Spec

## Overview

Add slash command support to the prompt input with an always-visible "/" button and autocomplete triggered by typing "/". The autocomplete appears above the input with fuzzy matching, keyboard navigation, and ARIA accessibility. Commands are fetched per-session from the SDK and displayed with descriptions and argument hints.

## Goals

- Provide discoverable access to all available slash commands via a button
- Enable fast command entry with "/" autocomplete
- Support keyboard-driven workflow with arrow navigation and Enter to select
- Display command descriptions and argument hints inline
- Highlight recognized commands in the input with an overlay

## Non-Goals

- Command history tracking
- Custom user-defined commands
- Special parameter input forms for command arguments
- Immediate send on selection (always insert into input)

## Requirements

### Button & Trigger

- Always-visible "/" button on the left side of the prompt input
- Clicking the button opens the command popover directly (does not insert "/" into input)
- Typing "/" as the first character triggers autocomplete
- Commands fetched fresh when switching sessions (plugins may differ by project)

### Autocomplete Popover

- Appears above the input (like Discord/Slack)
- Minimal dropdown style - lighter and tighter than modals, no heavy borders
- Fuzzy matching: "/sr" can match "security-review"
- Shows "No matches" state when input doesn't match any command (e.g., "/xyz")
- Each row displays: command name, description (grayed), argumentHint (grayed, in angle brackets)

### Selection & Keyboard

- Arrow keys navigate the list while typing continues to filter
- Enter or Tab inserts "/command " into input (with trailing space)
- Never auto-sends; user presses Enter again to send
- ARIA attributes: role="listbox", aria-selected, aria-activedescendant for screen readers

### Dismissal

- Escape key closes popover
- Clicking outside closes popover
- Backspace that removes the "/" character closes popover
- Popover closes when input loses focus

### Input Highlighting

- Overlay div approach: keep textarea, overlay a transparent div with styled spans
- Highlight the "/command" portion when a valid command is recognized
- Highlight style should be subtle (different color or background)

### Error Handling

- If SDK call fails or returns empty, button remains visible
- Popover shows "Could not load commands" error message
- Commands cached per session; re-fetched on session switch

## Technical Approach

### Data Flow

1. On session switch, send `get_commands` WebSocket message
2. Store commands in App state: `const [commands, setCommands] = useState([])`
3. Pass commands to PromptInput component
4. PromptInput manages popover visibility and selection state locally

### Components

**SlashCommandButton** - The "/" button, onClick opens popover

**CommandAutocomplete** - The popover itself:
- Props: commands, filter text, onSelect, onClose
- State: highlighted index for keyboard nav
- Renders filtered list with ARIA attributes
- Handles arrow keys, Enter, Escape

**PromptInput changes**:
- Add state for popover visibility
- Add state for overlay highlighting
- Detect "/" at start of input to trigger autocomplete
- Overlay div positioned absolutely over textarea for command highlighting

### Fuzzy Matching

Simple scoring: check if all characters in query appear in order in the target string. For a small command list (<50), no optimization needed.

```javascript
function fuzzyMatch(query, target) {
  let qi = 0
  for (const char of target.toLowerCase()) {
    if (char === query[qi]) qi++
    if (qi === query.length) return true
  }
  return false
}
```

### Overlay Highlighting

```
<div class="prompt-input-container">
  <div class="prompt-overlay" aria-hidden="true">
    <span class="command-highlight">/compact</span>
    <span class="rest-of-input"> custom summary instructions</span>
  </div>
  <textarea class="prompt-input">...</textarea>
</div>
```

CSS positions overlay exactly over textarea with matching font/padding. Textarea has transparent background where highlighting occurs.

## Open Questions

- Should we prefetch commands on WebSocket connect for faster initial display? (Currently: no, fetch per session)
- Should the button have a tooltip? (Leaning: yes, "Slash commands" on hover)

## Acceptance Criteria

- [x] "/" button visible left of prompt input
- [x] Clicking button opens command popover
- [x] Typing "/" at start of input opens popover
- [x] Popover shows above input with all commands
- [x] Typing filters commands with fuzzy matching
- [x] Arrow keys navigate, Enter/Tab selects
- [x] Selected command inserted as "/command " with space
- [x] Escape, click outside, or removing "/" closes popover
- [x] Commands show name, description, and argumentHint in list
- [x] "No matches" shown for unrecognized input
- [x] "Could not load commands" shown on fetch error
- [x] Recognized command highlighted in input with overlay
- [x] ARIA attributes present for accessibility
- [x] Commands refetched when switching sessions
