import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import htm from 'htm'
import { fuzzyMatch, fuzzyScore } from '../utils.js'

const html = htm.bind(h)

// Command autocomplete popover
export function CommandAutocomplete({ commands, commandsError, filter, onSelect, onClose, highlightedIndex, setHighlightedIndex }) {
  const listRef = useRef(null)
  const safeCommands = commands || []

  // Filter and sort commands
  const filteredCommands = safeCommands
    .filter(cmd => fuzzyMatch(filter, cmd.name))
    .sort((a, b) => fuzzyScore(filter, a.name) - fuzzyScore(filter, b.name))

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && highlightedIndex >= 0) {
      const item = listRef.current.children[highlightedIndex]
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  // Error state
  if (commandsError) {
    return html`
      <div class="command-autocomplete" role="listbox" aria-label="Slash commands">
        <div class="command-autocomplete-error">${commandsError}</div>
      </div>
    `
  }

  // No matches state
  if (filteredCommands.length === 0) {
    return html`
      <div class="command-autocomplete" role="listbox" aria-label="Slash commands">
        <div class="command-autocomplete-empty">No matching commands</div>
      </div>
    `
  }

  return html`
    <div class="command-autocomplete" role="listbox" aria-label="Slash commands" ref=${listRef}>
      ${filteredCommands.map((cmd, i) => html`
        <div
          key=${cmd.name}
          class="command-item ${i === highlightedIndex ? 'highlighted' : ''}"
          role="option"
          aria-selected=${i === highlightedIndex}
          onClick=${() => onSelect(cmd)}
          onMouseEnter=${() => setHighlightedIndex(i)}
        >
          <span class="command-name">/${cmd.name}</span>
          ${cmd.argumentHint && html`
            <span class="command-args">${'<'}${cmd.argumentHint}${'>'}</span>
          `}
          <span class="command-description">${cmd.description}</span>
        </div>
      `)}
    </div>
  `
}

// Prompt input component
export function PromptInput({ onSubmit, disabled, commands, commandsError }) {
  const [value, setValue] = useState('')
  const [images, setImages] = useState([]) // { id, dataUrl, mimeType }
  const [showCommands, setShowCommands] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const containerRef = useRef(null)

  const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  // Ensure commands is always an array
  const safeCommands = commands || []

  // Parse command from input - returns { commandFilter, isCommand, matchedCommand }
  const parseCommand = (text) => {
    if (!text.startsWith('/')) {
      return { commandFilter: '', isCommand: false, matchedCommand: null }
    }

    // Extract the command part (first word after /)
    const match = text.match(/^\/(\S*)/)
    const commandFilter = match ? match[1] : ''

    // Check if it exactly matches a command
    const matchedCommand = safeCommands.find(cmd => cmd.name === commandFilter)

    return { commandFilter, isCommand: true, matchedCommand }
  }

  const { commandFilter, isCommand, matchedCommand } = parseCommand(value)

  // Filter commands for autocomplete
  const filteredCommands = safeCommands.filter(cmd => fuzzyMatch(commandFilter, cmd.name))
    .sort((a, b) => fuzzyScore(commandFilter, a.name) - fuzzyScore(commandFilter, b.name))

  // Show autocomplete when typing slash command
  const shouldShowCommands = showCommands || (isCommand && filteredCommands.length > 0)

  // Close autocomplete when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowCommands(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [commandFilter])

  const addImageFile = async (file) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      alert('Unsupported image format. Please use JPEG, PNG, GIF, or WebP.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      alert('Image too large. Maximum size is 20MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      setImages(prev => [...prev, {
        id: Math.random().toString(36).slice(2),
        dataUrl: e.target.result,
        mimeType: file.type
      }])
    }
    reader.readAsDataURL(file)
  }

  const handlePaste = async (e) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) await addImageFile(file)
      }
    }
  }

  const handleFileSelect = (e) => {
    const files = e.target.files
    if (!files) return
    for (const file of files) {
      addImageFile(file)
    }
    e.target.value = '' // Reset so same file can be selected again
  }

  const removeImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id))
  }

  const handleSubmit = () => {
    if ((value.trim() || images.length > 0) && !disabled) {
      onSubmit({ text: value.trim(), images })
      setValue('')
      setImages([])
      setShowCommands(false)
    }
  }

  const handleSelectCommand = (cmd) => {
    // Insert the command with a trailing space
    setValue(`/${cmd.name} `)
    setShowCommands(false)
    textareaRef.current?.focus()
  }

  const handleSlashButtonClick = () => {
    setShowCommands(!showCommands)
    setHighlightedIndex(0)
  }

  const handleInput = (e) => {
    const newValue = e.target.value
    const prevValue = value

    setValue(newValue)

    // Close autocomplete if backspace removed the leading /
    if (prevValue.startsWith('/') && !newValue.startsWith('/')) {
      setShowCommands(false)
    }
  }

  const handleKeyDown = (e) => {
    // Handle autocomplete navigation
    if (shouldShowCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex(i => Math.min(i + 1, filteredCommands.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredCommands[highlightedIndex]) {
          e.preventDefault()
          handleSelectCommand(filteredCommands[highlightedIndex])
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowCommands(false)
        return
      }
    }

    // Normal submit on Enter (without shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleBlur = () => {
    // Delay to allow click on autocomplete item to register
    setTimeout(() => {
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        setShowCommands(false)
      }
    }, 150)
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [value])

  const canSubmit = !disabled && (value.trim() || images.length > 0)

  // Compute overlay content for command highlighting
  const renderOverlay = () => {
    if (!matchedCommand) return null

    // Find where the command ends (first space after /command or end of string)
    const commandEndMatch = value.match(/^\/\S+/)
    if (!commandEndMatch) return null

    const commandPart = commandEndMatch[0]
    const restPart = value.slice(commandPart.length)

    return html`
      <div class="prompt-overlay" aria-hidden="true">
        <span class="command-highlight">${commandPart}</span>${restPart}
      </div>
    `
  }

  return html`
    <div class="prompt-container" ref=${containerRef}>
      ${images.length > 0 && html`
        <div class="image-preview-container">
          ${images.map(img => html`
            <div class="image-preview" key=${img.id}>
              <img src=${img.dataUrl} alt="Preview" />
              <button
                class="image-preview-remove"
                onClick=${() => removeImage(img.id)}
                title="Remove image"
              >×</button>
            </div>
          `)}
        </div>
      `}

      ${shouldShowCommands && html`
        <${CommandAutocomplete}
          commands=${safeCommands}
          commandsError=${commandsError}
          filter=${commandFilter}
          onSelect=${handleSelectCommand}
          onClose=${() => setShowCommands(false)}
          highlightedIndex=${highlightedIndex}
          setHighlightedIndex=${setHighlightedIndex}
        />
      `}

      <div class="prompt-input-wrapper">
        <input
          ref=${fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          style="display: none"
          onChange=${handleFileSelect}
        />
        <button
          class="btn btn-slash"
          onClick=${handleSlashButtonClick}
          disabled=${disabled}
          title="Slash commands"
          aria-expanded=${shouldShowCommands}
          aria-haspopup="listbox"
        >/</button>
        <button
          class="btn btn-attach"
          onClick=${() => fileInputRef.current?.click()}
          disabled=${disabled}
          title="Attach image"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <div class="prompt-input-container">
          ${renderOverlay()}
          <textarea
            ref=${textareaRef}
            class="prompt-input ${matchedCommand ? 'has-command' : ''}"
            value=${value}
            onInput=${handleInput}
            onKeyDown=${handleKeyDown}
            onPaste=${handlePaste}
            onBlur=${handleBlur}
            placeholder=${disabled ? 'Waiting for response...' : 'Type a message or paste an image...'}
            disabled=${disabled}
            rows="1"
            aria-autocomplete="list"
            aria-controls=${shouldShowCommands ? 'command-autocomplete' : undefined}
          ></textarea>
        </div>
        <button
          class="btn btn-primary"
          onClick=${handleSubmit}
          disabled=${!canSubmit}
        >
          Send
        </button>
      </div>
    </div>
  `
}
