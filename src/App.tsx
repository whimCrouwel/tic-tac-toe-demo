import { useState, useEffect, useCallback, useRef } from 'react'
import QRCode from 'qrcode'
import { socket } from './lib/socket'

type Screen = 'lobby' | 'waiting' | 'game'
type Board = (string | null)[]

interface GameState {
  board: Board
  xIsNext: boolean
  winner: string | null
}

function calcWinner(board: Board): string | null {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ]
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]!
  }
  return null
}

function useQrCode(text: string) {
  const [dataUrl, setDataUrl] = useState('')
  useEffect(() => {
    if (!text) return
    QRCode.toDataURL(text, { width: 200, margin: 2, color: { dark: '#000', light: '#fff' } }).then(setDataUrl)
  }, [text])
  return dataUrl
}

const CENTER: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('lobby')
  const [nickname, setNickname] = useState('')
  const [joinCode, setJoinCode] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('code') ?? ''
  })
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [isHost, setIsHost] = useState(false)
  const [myMark, setMyMark] = useState<'X' | 'O'>('X')
  const [notification, setNotification] = useState('')
  const [roomStatus, setRoomStatus] = useState<{ available: number; max: number } | null>(null)
  const [game, setGame] = useState<GameState>({ board: Array(9).fill(null), xIsNext: true, winner: null })
  const seqRef = useRef(0)
  const isHostRef = useRef(false)
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const joinUrl = roomCode
    ? `${window.location.origin}${window.location.pathname}?code=${roomCode}`
    : ''
  const qrDataUrl = useQrCode(joinUrl)

  const showNotification = useCallback((msg: string) => {
    setNotification(msg)
    if (notifTimer.current) clearTimeout(notifTimer.current)
    notifTimer.current = setTimeout(() => setNotification(''), 4000)
  }, [])

  useEffect(() => {
    fetch('/status')
      .then((r) => r.json())
      .then((data) => setRoomStatus(data as { available: number; max: number }))
      .catch(() => {})
  }, [])

  const applySnapshot = useCallback((blob: unknown) => {
    setGame(blob as GameState)
  }, [])

  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(socket.on('room.created', (msg) => {
      setRoomCode(msg.code as string)
      setIsHost(true)
      isHostRef.current = true
      setMyMark('X')
      setScreen('waiting')
    }))

    unsubs.push(socket.on('room.joined', (msg) => {
      setRoomCode(msg.code as string)
      type Member = { playerId: string; host: boolean }
      const members = (msg.members as Member[]) ?? []
      const me = members.find((m) => m.playerId === socket.playerId)
      const host = me?.host ?? false
      setIsHost(host)
      isHostRef.current = host
      setMyMark(host ? 'X' : 'O')
      setScreen('game')
    }))

    unsubs.push(socket.on('presence', (msg) => {
      const name = msg.nickname as string
      const event = msg.event as string
      if (event === 'join' || event === 'reconnect') {
        if (screen === 'waiting') setScreen('game')
        if (event === 'reconnect') showNotification(`${name} reconnected`)
      }
      if (event === 'disconnect') showNotification(`${name} disconnected`)
      if (event === 'leave') showNotification(`${name} left the game`)
    }))

    unsubs.push(socket.on('move', (msg) => {
      const seq = msg.seq as number
      seqRef.current = seq
      const payload = msg.payload as { cell?: number; reset?: boolean }

      if (payload.reset) {
        const fresh: GameState = { board: Array(9).fill(null), xIsNext: true, winner: null }
        setGame(fresh)
        if (isHostRef.current) socket.sendWithReqId({ type: 'snapshot.set', seq, state: fresh })
        return
      }

      setGame((prev) => {
        if (prev.winner) return prev
        const board = [...prev.board]
        board[payload.cell!] = prev.xIsNext ? 'X' : 'O'
        const winner = calcWinner(board)
        const next = { board, xIsNext: !prev.xIsNext, winner }
        if (isHostRef.current) socket.sendWithReqId({ type: 'snapshot.set', seq, state: next })
        return next
      })
    }))

    unsubs.push(socket.on('snapshot', (msg) => {
      applySnapshot((msg as Record<string, unknown>).state)
    }))

    unsubs.push(socket.on('error', (msg) => {
      setError(String(msg.message ?? msg.code))
    }))

    return () => unsubs.forEach((u) => u())
  }, [screen, applySnapshot, showNotification])

  async function handleConnect(creating: boolean) {
    if (!nickname.trim()) { setError('Enter a nickname'); return }
    if (!creating && !joinCode.trim()) { setError('Enter a join code'); return }
    setError('')
    try {
      await socket.connect(nickname.trim())
    } catch {
      setError('Cannot connect to server')
      return
    }
    if (creating) {
      socket.sendWithReqId({ type: 'room.create' })
    } else {
      socket.sendWithReqId({ type: 'room.join', code: joinCode.trim().toUpperCase() })
    }
  }

  function handleCellClick(i: number) {
    if (game.winner || game.board[i]) return
    const myTurn = (game.xIsNext && myMark === 'X') || (!game.xIsNext && myMark === 'O')
    if (!myTurn) return
    socket.sendWithReqId({ type: 'move', payload: { cell: i } })
  }

  function handleReset() {
    socket.sendWithReqId({ type: 'move', payload: { reset: true } })
  }

  // ── Lobby ────────────────────────────────────────────────────────────────
  if (screen === 'lobby') {
    return (
      <div style={CENTER}>
        {notification && <div className="toast">{notification}</div>}
        <div className="card">
          <p className="logo">boardgame-ws demo</p>
          <h1 className="title">Tic-Tac-Toe</h1>

          <input
            className="input"
            placeholder="Your nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect(!joinCode)}
          />
          <input
            className="input"
            placeholder="Join code — leave blank to create"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect(!joinCode)}
            style={{ fontFamily: joinCode ? 'monospace' : 'inherit', letterSpacing: joinCode ? 4 : 0 }}
          />

          {roomStatus && (
            <p className={`status-line${roomStatus.available === 0 ? ' error' : ''}`}>
              {roomStatus.available === 0
                ? 'Server is full — no rooms available'
                : `${roomStatus.available} of ${roomStatus.max} rooms open`}
            </p>
          )}
          {error && <p className="error-msg">{error}</p>}

          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => handleConnect(true)}>Create Room</button>
            <button className="btn btn-ghost" onClick={() => handleConnect(false)}>Join</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Waiting ──────────────────────────────────────────────────────────────
  if (screen === 'waiting') {
    return (
      <div style={CENTER}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner" />
          <h2 className="title" style={{ marginBottom: 4 }}>Waiting for opponent</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>
            Share the code or scan the QR
          </p>

          {qrDataUrl && (
            <div className="qr-wrap">
              <img src={qrDataUrl} alt="Join QR" width={180} height={180} />
            </div>
          )}

          <p className="room-label">Room code</p>
          <div className="room-code">{roomCode}</div>

          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            You are <span className="mark-badge x">X</span>
          </p>
        </div>
      </div>
    )
  }

  // ── Game ─────────────────────────────────────────────────────────────────
  const myTurn = (game.xIsNext && myMark === 'X') || (!game.xIsNext && myMark === 'O')
  const isDraw = !game.winner && game.board.every(Boolean)
  const isOver = !!game.winner || isDraw

  return (
    <div style={CENTER}>
      {notification && <div className="toast">{notification}</div>}
      <div className="card">
        <p className="room-label" style={{ marginBottom: 2 }}>Room · {roomCode}</p>

        {isOver ? (
          <p className="result-banner" style={{ margin: '12px 0 0' }}>
            {game.winner ? `${game.winner} wins!` : 'Draw!'}
          </p>
        ) : (
          <div className="turn-indicator" style={{ margin: '12px 0 0' }}>
            {myTurn && <span className="turn-dot" />}
            <span>
              {myTurn ? 'Your turn' : "Opponent's turn"}
            </span>
            <span className={`mark-badge ${myMark.toLowerCase()}`}>{myMark}</span>
          </div>
        )}

        <div className="board">
          {game.board.map((val, i) => (
            <button
              key={i}
              className={`cell${val ? ` filled ${val.toLowerCase()}` : ''}${isOver ? ' done' : ''}`}
              onClick={() => handleCellClick(i)}
            >
              {val}
            </button>
          ))}
        </div>

        {isOver && isHost && (
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleReset}>
            Play Again
          </button>
        )}
        {isOver && !isHost && (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
            Waiting for host to restart…
          </p>
        )}
      </div>
    </div>
  )
}
