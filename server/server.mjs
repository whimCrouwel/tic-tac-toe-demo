import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, join } from 'path'
import { fileURLToPath } from 'url'
import { GameServer } from 'boardgame-ws'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(__dirname, '../dist')
const PORT = parseInt(process.env.PORT ?? '8787', 10)
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS ?? '10', 10)
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS ?? '2', 10)

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
}

let roomCount = 0

const httpServer = createServer(async (req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ available: MAX_ROOMS - roomCount, max: MAX_ROOMS }))
    return
  }

  // Serve static files from dist/
  let urlPath = req.url?.split('?')[0] ?? '/'
  if (urlPath === '/') urlPath = '/index.html'

  try {
    const filePath = join(DIST, urlPath)
    const data = await readFile(filePath)
    const mime = MIME[extname(urlPath)] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime })
    res.end(data)
  } catch {
    // SPA fallback — serve index.html for unknown paths
    try {
      const data = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  }
})

const wsServer = new GameServer({
  maxPlayersPerRoom: MAX_PLAYERS,
  maxRooms: MAX_ROOMS,
  reconnectGraceMs: 120_000,
  roomTtlMs: 600_000,
})

wsServer.on('roomCreated', (code) => { roomCount++; console.log(`room created: ${code} (${roomCount}/${MAX_ROOMS})`) })
wsServer.on('roomClosed',  (code) => { roomCount--; console.log(`room closed:  ${code} (${roomCount}/${MAX_ROOMS})`) })
wsServer.on('playerJoined', (code, id) => console.log(`join  ${code}: ${id}`))
wsServer.on('playerLeft',   (code, id) => console.log(`leave ${code}: ${id}`))

wsServer.attach(httpServer)
httpServer.listen(PORT, () => console.log(`listening on port ${PORT}`))
