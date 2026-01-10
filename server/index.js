import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer } from 'ws'
import { loadConfig } from './config.js'
import { ensureToken } from './auth.js'
import { handleConnection } from './ws-handler.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url

  // Remove query string
  const queryIndex = filePath.indexOf('?')
  if (queryIndex !== -1) {
    filePath = filePath.slice(0, queryIndex)
  }

  // Security: prevent directory traversal
  if (filePath.includes('..')) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const fullPath = join(PUBLIC_DIR, filePath)

  if (!existsSync(fullPath)) {
    res.writeHead(404)
    res.end('Not Found')
    return
  }

  try {
    const content = readFileSync(fullPath)
    const ext = extname(fullPath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  } catch {
    res.writeHead(500)
    res.end('Internal Server Error')
  }
}

function main() {
  const config = loadConfig()
  const token = ensureToken()

  // Create HTTP server
  const server = createServer((req, res) => {
    serveStatic(req, res)
  })

  // Create WebSocket server
  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws, req) => {
    handleConnection(ws, req, config)
  })

  server.listen(config.port, () => {
    console.log('')
    console.log('  ╔═══════════════════════════════════════╗')
    console.log('  ║           CLARVIS SERVER              ║')
    console.log('  ╚═══════════════════════════════════════╝')
    console.log('')
    console.log(`  Local:    http://localhost:${config.port}`)
    console.log(`  Projects: ${config.projectsRoot}`)
    console.log('')
    console.log('  Auth Token:')
    console.log(`  ${token}`)
    console.log('')
    console.log('  Connect with token in query string:')
    console.log(`  ws://localhost:${config.port}?token=${token}`)
    console.log('')
  })
}

main()
