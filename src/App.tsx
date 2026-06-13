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

const GITHUB_URL = 'https://github.com/whimCrouwel/boardgame-ws'
const AUTHOR_URL = 'https://whim-on-vim.com'

function Header() {
  return (
    <header className="header">
      <a className="header-logo" href={GITHUB_URL} target="_blank" rel="noreferrer">
        boardgame-ws
      </a>
      <nav className="header-links">
        <a className="header-link" href={AUTHOR_URL} target="_blank" rel="noreferrer">
          whim-on-vim.com
        </a>
        <a className="header-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
          </svg>
          GitHub
        </a>
      </nav>
    </header>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <p className="footer-text">
        © 2026 <a className="footer-link" href={AUTHOR_URL} target="_blank" rel="noreferrer">whim-on-vim.com</a>
      </p>
      <a className="footer-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
        boardgame-ws — MIT License
      </a>
    </footer>
  )
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
        if (event === 'reconnect') showNotification(`${name} が再接続しました`)
      }
      if (event === 'disconnect') showNotification(`${name} が切断されました`)
      if (event === 'leave') showNotification(`${name} がゲームを離れました`)
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
    if (!nickname.trim()) { setError('ニックネームを入力してください'); return }
    if (!creating && !joinCode.trim()) { setError('参加コードを入力してください'); return }
    setError('')
    try {
      await socket.connect(nickname.trim())
    } catch {
      setError('サーバーに接続できません')
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
      <div className="page">
        <Header />
        {notification && <div className="toast">{notification}</div>}

        <section className="hero">
          <div className="hero-eyebrow">WebSocket Server SDK</div>
          <h1 className="hero-title">リアルタイム対戦を<br />かんたんに。</h1>
          <p className="hero-desc">
            <code style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>boardgame-ws</code> は、
            ターン制マルチプレイヤーゲームのための Node.js WebSocket サーバー SDK です。
            ルーム管理・順序保証・再接続リカバリーが数行で使えます。
          </p>
          <div className="hero-badges">
            <span className="badge">ルームコードで招待</span>
            <span className="badge">再接続サポート</span>
            <span className="badge">スナップショット同期</span>
            <span className="badge">ゲームロジック不要</span>
            <span className="badge">TypeScript 完全対応</span>
          </div>
          <p className="demo-label">デモを試す</p>
        </section>

        <div className="demo">
          <div className="card">
            <p className="logo">Tic-Tac-Toe — Live Demo</p>
            <h2 className="title">三目並べ</h2>

            <input
              className="input"
              placeholder="ニックネーム"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect(!joinCode)}
            />
            <input
              className="input"
              placeholder="参加コード（空欄でルーム作成）"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect(!joinCode)}
              style={{ fontFamily: joinCode ? 'monospace' : 'inherit', letterSpacing: joinCode ? 4 : 0 }}
            />

            {roomStatus && (
              <p className={`status-line${roomStatus.available === 0 ? ' error' : ''}`}>
                {roomStatus.available === 0
                  ? 'サーバーが満室です'
                  : `空きルーム ${roomStatus.available} / ${roomStatus.max}`}
              </p>
            )}
            {error && <p className="error-msg">{error}</p>}

            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => handleConnect(true)}>ルーム作成</button>
              <button className="btn btn-ghost" onClick={() => handleConnect(false)}>参加する</button>
            </div>
          </div>
        </div>

        <Footer />
      </div>
    )
  }

  // ── Waiting ──────────────────────────────────────────────────────────────
  if (screen === 'waiting') {
    return (
      <div className="page">
        <Header />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 24px 24px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="spinner" />
          <h2 className="title" style={{ marginBottom: 4 }}>相手を待っています</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>
            コードをシェアするか、QR をスキャン
          </p>

          {qrDataUrl && (
            <div className="qr-wrap">
              <img src={qrDataUrl} alt="Join QR" width={180} height={180} />
            </div>
          )}

          <p className="room-label">ルームコード</p>
          <div className="room-code">{roomCode}</div>

          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            あなたは <span className="mark-badge x">X</span>
          </p>
        </div>
        </div>
        <Footer />
      </div>
    )
  }

  // ── Game ─────────────────────────────────────────────────────────────────
  const myTurn = (game.xIsNext && myMark === 'X') || (!game.xIsNext && myMark === 'O')
  const isDraw = !game.winner && game.board.every(Boolean)
  const isOver = !!game.winner || isDraw

  return (
    <div className="page">
      <Header />
      {notification && <div className="toast">{notification}</div>}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 24px 24px' }}>
      <div className="card">
        <p className="room-label" style={{ marginBottom: 2 }}>ルーム · {roomCode}</p>

        {isOver ? (
          <p className="result-banner" style={{ margin: '12px 0 0' }}>
            {game.winner ? `${game.winner} の勝ち！` : '引き分け！'}
          </p>
        ) : (
          <div className="turn-indicator" style={{ margin: '12px 0 0' }}>
            {myTurn && <span className="turn-dot" />}
            <span>
              {myTurn ? 'あなたのターン' : '相手のターン'}
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
            もう一度
          </button>
        )}
        {isOver && !isHost && (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
            ホストの再開を待っています…
          </p>
        )}
      </div>
      </div>
      <Footer />
    </div>
  )
}
