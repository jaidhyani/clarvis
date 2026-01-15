import { h } from 'preact'
import { useState } from 'preact/hooks'
import htm from 'htm'
import { renderMarkdown } from '../utils.js'

const html = htm.bind(h)

// Tool call component
export function ToolCall({ name, input }) {
  const [expanded, setExpanded] = useState(false)

  const summary = typeof input === 'object'
    ? Object.entries(input).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(', ')
    : String(input).slice(0, 50)

  return html`
    <div class="tool-call">
      <div class="tool-call-header" onClick=${() => setExpanded(!expanded)}>
        <span class="tool-call-icon">${expanded ? '▼' : '▶'}</span>
        <span class="tool-call-name">${name}</span>
        <span class="tool-call-summary">${summary}</span>
      </div>
      <div class="tool-call-body ${expanded ? '' : 'hidden'}">
        ${JSON.stringify(input, null, 2)}
      </div>
    </div>
  `
}

// Tool result component
export function ToolResult({ content }) {
  const [expanded, setExpanded] = useState(false)

  const text = Array.isArray(content)
    ? content.filter(c => c.type === 'text').map(c => c.text).join('\n')
    : String(content || '')

  // Don't render empty results
  if (!text.trim()) return null

  const preview = text.slice(0, 100) + (text.length > 100 ? '...' : '')

  return html`
    <div class="tool-call">
      <div class="tool-call-header" onClick=${() => setExpanded(!expanded)}>
        <span class="tool-call-icon">${expanded ? '▼' : '▶'}</span>
        <span class="tool-call-name" style="color: var(--accent-success)">Result</span>
        <span class="tool-call-summary">${preview}</span>
      </div>
      <div class="tool-call-body ${expanded ? '' : 'hidden'}">
        ${text}
      </div>
    </div>
  `
}

// Message component
export function Message({ message, onImageClick }) {
  if (message.type === 'user') {
    const content = message.message?.content || []
    const textBlocks = Array.isArray(content)
      ? content.filter(c => c.type === 'text')
      : []
    const imageBlocks = Array.isArray(content)
      ? content.filter(c => c.type === 'image')
      : []

    const text = textBlocks.map(c => c.text).join('\n')
    const hasContent = text || imageBlocks.length > 0

    if (!hasContent) return null

    return html`
      <div class="message message-user">
        ${imageBlocks.map((img, i) => {
          const src = img.source?.type === 'base64'
            ? 'data:' + img.source.media_type + ';base64,' + img.source.data
            : img.source?.url
          return html`<img
            key=${i}
            class="message-image"
            src=${src}
            alt="Attached image"
            onClick=${() => onImageClick?.(src)}
          />`
        })}
        ${text && html`<div>${text}</div>`}
      </div>
    `
  }

  if (message.type === 'assistant') {
    const content = message.message?.content
    const text = Array.isArray(content)
      ? content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : content
    // Don't render empty assistant messages
    if (!text) return null
    return html`<div class="message message-assistant markdown-body" dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}></div>`
  }

  // Hide init messages - they're confusing after the user's first prompt
  if (message.type === 'system' && message.subtype === 'init') {
    return null
  }

  // Permission resolution message
  if (message.type === 'permission') {
    const allowed = message.decision === 'allow'
    return html`
      <div class="message message-system" style="display: flex; align-items: center; gap: 8px;">
        <span style="color: ${allowed ? 'var(--accent-success)' : 'var(--accent-error)'}">
          ${allowed ? '✓' : '✗'}
        </span>
        <span>
          ${allowed ? 'Allowed' : 'Denied'}: ${message.toolName}
          ${message.decisionMessage ? ` - ${message.decisionMessage}` : ''}
        </span>
      </div>
    `
  }

  // Tool calls are rendered inline with content blocks
  if (message.message?.content) {
    const content = message.message.content
    const rendered = content.map((block, i) => {
      if (block.type === 'text' && block.text?.trim()) {
        return html`<div key=${i} class="message message-assistant markdown-body" dangerouslySetInnerHTML=${{ __html: renderMarkdown(block.text) }}></div>`
      }
      if (block.type === 'tool_use') {
        return html`<${ToolCall} key=${i} name=${block.name} input=${block.input} />`
      }
      if (block.type === 'tool_result') {
        return html`<${ToolResult} key=${i} content=${block.content} />`
      }
      return null
    }).filter(Boolean)

    if (rendered.length === 0) return null
    return html`${rendered}`
  }

  return null
}

// Message stream component
export function MessageStream({ messages, messagesEndRef, isLoading, onImageClick }) {
  return html`
    <div class="message-stream">
      ${messages.map((msg, i) => html`
        <${Message} key=${i} message=${msg} onImageClick=${onImageClick} />
      `)}
      ${isLoading && html`
        <div class="typing-indicator">
          <span></span>
          <span></span>
          <span></span>
        </div>
      `}
      <div ref=${messagesEndRef}></div>
    </div>
  `
}
