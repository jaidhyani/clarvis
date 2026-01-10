// WebSocket client with auto-reconnect

export function createWebSocket(token, handlers) {
  let ws = null
  let reconnectAttempts = 0
  let reconnectTimeout = null
  const maxReconnectAttempts = 10
  const baseReconnectDelay = 1000

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}?token=${token}`

    ws = new WebSocket(url)

    ws.onopen = () => {
      reconnectAttempts = 0
      handlers.onConnect?.()
    }

    ws.onclose = (event) => {
      ws = null

      if (event.code === 4001) {
        handlers.onAuthError?.()
        return
      }

      handlers.onDisconnect?.()
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will be called after this
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        handlers.onMessage?.(message)
      } catch {
        console.error('Failed to parse WebSocket message')
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= maxReconnectAttempts) {
      handlers.onMaxReconnectAttempts?.()
      return
    }

    const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts)
    reconnectAttempts++

    handlers.onReconnecting?.(reconnectAttempts, maxReconnectAttempts)

    reconnectTimeout = setTimeout(() => {
      connect()
    }, delay)
  }

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
      return true
    }
    return false
  }

  function close() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
  }

  function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN
  }

  // Start connection
  connect()

  return {
    send,
    close,
    isConnected,
    reconnect: connect
  }
}
