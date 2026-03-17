import { useEffect, useRef, useCallback, useReducer, useMemo } from 'react'
import './App.css'
import {
    type Direction, type Point, GRID, SPEED_MS,
    createInitialSnake, moveSnake, grow,
    isDead, placeFood, oppositeDir,
} from './gameLogic'

// ── Types ──────────────────────────────────────────────

type Speed = 'slow' | 'normal' | 'fast'

interface Stats {
    gamesPlayed: number
    bestScore: number
    totalFood: number
}

function loadStats(): Stats {
    try {
        return JSON.parse(localStorage.getItem('snake-stats') || 'null') ?? { gamesPlayed: 0, bestScore: 0, totalFood: 0 }
    } catch { return { gamesPlayed: 0, bestScore: 0, totalFood: 0 } }
}

function saveStats(s: Stats) {
    localStorage.setItem('snake-stats', JSON.stringify(s))
}

// ── Theme ──────────────────────────────────────────────

function getInitialTheme(): string {
    const stored = localStorage.getItem('barczynski-theme')
    if (stored) return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: string) {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('barczynski-theme', theme)
}

// ── Game state ─────────────────────────────────────────

type Phase = 'idle' | 'running' | 'dead'

interface GameState {
    snake: Point[]
    food: Point
    dir: Direction
    pendingDir: Direction
    score: number
    phase: Phase
}

function initState(): GameState {
    const snake = createInitialSnake()
    return {
        snake,
        food: placeFood(snake),
        dir: 'RIGHT',
        pendingDir: 'RIGHT',
        score: 0,
        phase: 'idle',
    }
}

type Action =
    | { type: 'START' }
    | { type: 'TICK' }
    | { type: 'STEER'; dir: Direction }
    | { type: 'RESET' }

function reducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'START':
            return { ...state, phase: 'running' }

        case 'STEER': {
            if (oppositeDir(state.dir, action.dir)) return state
            return { ...state, pendingDir: action.dir }
        }

        case 'TICK': {
            if (state.phase !== 'running') return state
            const newDir = state.pendingDir
            const moved = moveSnake(state.snake, newDir)
            if (isDead(moved)) {
                return { ...state, dir: newDir, snake: moved, phase: 'dead' }
            }
            const ateFood = moved[0].x === state.food.x && moved[0].y === state.food.y
            const newSnake = ateFood ? grow(moved) : moved
            const newFood = ateFood ? placeFood(newSnake) : state.food
            return {
                ...state,
                dir: newDir,
                pendingDir: newDir,
                snake: newSnake,
                food: newFood,
                score: ateFood ? state.score + 1 : state.score,
                phase: 'running',
            }
        }

        case 'RESET':
            return initState()

        default:
            return state
    }
}

// ── Board building ─────────────────────────────────────

type CellType = 'empty' | 'head' | 'body' | 'tail' | 'food'

function buildGrid(snake: Point[], food: Point): CellType[][] {
    const grid: CellType[][] = Array.from({ length: GRID }, () => Array(GRID).fill('empty'))
    for (let i = snake.length - 1; i >= 0; i--) {
        const { x, y } = snake[i]
        if (x < 0 || x >= GRID || y < 0 || y >= GRID) continue
        if (i === 0) grid[y][x] = 'head'
        else if (i === snake.length - 1) grid[y][x] = 'tail'
        else grid[y][x] = 'body'
    }
    grid[food.y][food.x] = 'food'
    return grid
}

// ── Main component ─────────────────────────────────────

export default function App() {
    const [state, dispatch] = useReducer(reducer, undefined, initState)
    const [theme, setThemeState] = useThemeState()
    const [speed, setSpeed] = useSpeedState()
    const [showHelp, openHelp, isHelpClosing, closeHelp] = useClosableOverlay()
    const [showStats, openStats, isStatsClosing, closeStats] = useClosableOverlay()
    const [stats, setStats] = useStatsData()
    const [shake, setShake] = useShakeState()
    const [scoreDelta, setScoreDelta] = useScoreDeltaState()
    const [isNewBest, setIsNewBest] = useNewBestState()
    const [flashHead, setFlashHead] = useFlashHeadState()
    const [speedRecords, setSpeedRecords] = useSpeedRecordsState()
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const prevScore = useRef(state.score)
    const phaseRef = useRef(state.phase)
    phaseRef.current = state.phase
    const speedRef = useRef(speed)
    speedRef.current = speed
    useEffect(() => {
        if (state.score > prevScore.current) {
            setScoreDelta(state.score - prevScore.current)
            setTimeout(() => setScoreDelta(null), 800)
            setFlashHead(true)
            setTimeout(() => setFlashHead(false), 200)
        }
        prevScore.current = state.score
    }, [state.score, setScoreDelta, setFlashHead])

    // Game tick
    useEffect(() => {
        if (state.phase === 'running') {
            tickRef.current = setInterval(() => dispatch({ type: 'TICK' }), SPEED_MS[speed])
            return () => { if (tickRef.current) clearInterval(tickRef.current) }
        }
        if (tickRef.current) clearInterval(tickRef.current)
    }, [state.phase, speed])

    // Save stats on death — read fresh from localStorage to avoid stale closure
    useEffect(() => {
        if (state.phase === 'dead') {
            setShake(true)
            setTimeout(() => setShake(false), 500)
            const current = loadStats()
            setIsNewBest(state.score > current.bestScore)
            const next: Stats = {
                gamesPlayed: current.gamesPlayed + 1,
                bestScore: Math.max(current.bestScore, state.score),
                totalFood: current.totalFood + state.score,
            }
            setStats(next)
            saveStats(next)
            // Update per-speed best record
            const speedKey = `snake-best-${speedRef.current}`
            const prevBest = parseInt(localStorage.getItem(speedKey) || '0', 10)
            if (state.score > prevBest) localStorage.setItem(speedKey, String(state.score))
        }
    }, [state.phase, state.score, setStats, setIsNewBest])

    // Clear new-best badge when a new game starts
    useEffect(() => {
        if (state.phase === 'running') setIsNewBest(false)
    }, [state.phase, setIsNewBest])

    // Snapshot localStorage speed records when stats overlay opens
    useEffect(() => {
        if (showStats) setSpeedRecords({
            slow: parseInt(localStorage.getItem('snake-best-slow') || '0', 10),
            normal: parseInt(localStorage.getItem('snake-best-normal') || '0', 10),
            fast: parseInt(localStorage.getItem('snake-best-fast') || '0', 10),
        })
    }, [showStats, setSpeedRecords])

    // Keyboard — stable listener via phaseRef, registered once
    useEffect(() => {
        const dirMap: Record<string, Direction> = {
            ArrowUp: 'UP', w: 'UP', W: 'UP',
            ArrowDown: 'DOWN', s: 'DOWN', S: 'DOWN',
            ArrowLeft: 'LEFT', a: 'LEFT', A: 'LEFT',
            ArrowRight: 'RIGHT', d: 'RIGHT', D: 'RIGHT',
        }
        const onKey = (e: KeyboardEvent) => {
            const phase = phaseRef.current
            if (dirMap[e.key]) {
                e.preventDefault()
                if (phase === 'idle' || phase === 'dead') {
                    dispatch({ type: 'RESET' })
                    setTimeout(() => dispatch({ type: 'START' }), 10)
                } else {
                    dispatch({ type: 'STEER', dir: dirMap[e.key] })
                }
            }
            if (e.key === ' ') {
                e.preventDefault()
                if (phase === 'idle') dispatch({ type: 'START' })
                else if (phase === 'dead') { dispatch({ type: 'RESET' }); setTimeout(() => dispatch({ type: 'START' }), 10) }
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    // Touch swipe — stable listener via phaseRef, registered once
    useEffect(() => {
        let sx = 0, sy = 0
        const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
        const onEnd = (e: TouchEvent) => {
            const dx = e.changedTouches[0].clientX - sx
            const dy = e.changedTouches[0].clientY - sy
            if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return
            let dir: Direction
            if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'RIGHT' : 'LEFT'
            else dir = dy > 0 ? 'DOWN' : 'UP'
            const phase = phaseRef.current
            if (phase === 'idle' || phase === 'dead') {
                dispatch({ type: 'RESET' }); setTimeout(() => { dispatch({ type: 'START' }); dispatch({ type: 'STEER', dir }) }, 10)
            } else {
                dispatch({ type: 'STEER', dir })
            }
        }
        window.addEventListener('touchstart', onStart, { passive: true })
        window.addEventListener('touchend', onEnd, { passive: true })
        return () => { window.removeEventListener('touchstart', onStart); window.removeEventListener('touchend', onEnd) }
    }, [])

    const handleReset = useCallback(() => {
        dispatch({ type: 'RESET' })
        setTimeout(() => dispatch({ type: 'START' }), 10)
    }, [])

    const grid = useMemo(() => buildGrid(state.snake, state.food), [state.snake, state.food])
    const currentSpeedBest = parseInt(localStorage.getItem(`snake-best-${speed}`) || '0', 10)
    const isSpeedRecord = state.phase === 'running' && state.score > currentSpeedBest

    return (
        <>
            {/* Theme toggle */}
            <button
                className="theme-btn"
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; setThemeState(t); applyTheme(t) }}
            >
                {theme === 'dark' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                    </svg>
                )}
            </button>

            {/* Help overlay */}
            {showHelp && (
                <div className={`help-overlay${isHelpClosing ? ' overlay-exit' : ''}`} onClick={closeHelp}>
                    <div className="help-panel" onClick={e => e.stopPropagation()}>
                        <button className="help-close" onClick={closeHelp} aria-label="Close help">×</button>
                        <p className="help-title">How to play</p>
                        <div className="help-section">
                            <h3>Basics</h3>
                            <p>Guide the snake to eat food. Each piece eaten grows the snake and scores a point. Avoid hitting the walls or your own body.</p>
                        </div>
                        <div className="help-section">
                            <h3>Controls</h3>
                            <ul>
                                <li>Arrow keys or WASD to steer</li>
                                <li>Space bar to start / restart</li>
                                <li>Swipe on mobile</li>
                            </ul>
                        </div>
                        <div className="help-section">
                            <h3>Speed</h3>
                            <p>Choose Slow, Normal, or Fast before or during a game. Higher speed = more challenge.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats overlay */}
            {showStats && (
                <div className={`help-overlay${isStatsClosing ? ' overlay-exit' : ''}`} onClick={closeStats}>
                    <div className="help-panel" onClick={e => e.stopPropagation()}>
                        <button className="help-close" onClick={closeStats} aria-label="Close stats">×</button>
                        <p className="help-title">Statistics</p>
                        <div className="stats-row">
                            <div className="stat-item">
                                <span className="stat-value">{stats.gamesPlayed}</span>
                                <span className="stat-label">Games</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">{stats.bestScore}</span>
                                <span className="stat-label">Best</span>
                            </div>
                            <div className="stat-item">
                                <span className="stat-value">{stats.totalFood}</span>
                                <span className="stat-label">Total food</span>
                            </div>
                        </div>
                        <p className="leaderboard-title">Speed records</p>
                        {(['slow', 'normal', 'fast'] as Speed[]).map(s => (
                            <div className="leaderboard-row" key={s}>
                                <span className="leaderboard-label">{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                                <span className="leaderboard-score">{speedRecords[s]}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="container">
                {/* Header */}
                <div className="header">
                    <h1>snake</h1>
                    <button className="help-btn" onClick={openHelp} aria-label="How to play">
                        <span className="help-btn-icon">?</span>
                        <span className="help-btn-label">How to play</span>
                    </button>
                    <div className="scores-wrapper" aria-live="polite" aria-atomic="true">
                        <div className="score-container">
                            <div className="score-label">Score</div>
                            <div className="score-value">{state.score}</div>
                            {scoreDelta !== null && <div className="score-delta" key={state.score}>+{scoreDelta}</div>}
                        </div>
                        <div className="score-container">
                            <div className="score-label">Best</div>
                            <div className="score-value">{stats.bestScore}</div>
                            {isSpeedRecord && <span className="speed-record-dot" aria-label="New speed record" />}
                        </div>
                    </div>
                </div>

                {/* Sub-header */}
                <div className="game-intro">
                    <div className="intro-buttons">
                        <button className="restart-button" onClick={handleReset}>Restart</button>
                        <button className="stats-button" onClick={openStats}>Stats</button>
                    </div>
                    {/* Speed selector */}
                    <div className="speed-selector">
                        {(['slow', 'normal', 'fast'] as Speed[]).map(s => (
                            <button
                                key={s}
                                className={`speed-btn${speed === s ? ' speed-btn-active' : ''}`}
                                onClick={() => setSpeed(s)}
                                aria-pressed={speed === s}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Board */}
                <div className={`game-container${shake ? ' game-over-shake' : ''}`} role="application" aria-label="Snake game board">
                    <div className="grid-canvas">
                        {grid.map((row, y) =>
                            row.map((cell, x) => (
                                <div
                                    key={`${x}-${y}`}
                                    className={`grid-cell${cell !== 'empty' ? ` cell-${cell === 'head' ? 'snake-head' : cell === 'body' ? 'snake-body' : cell === 'tail' ? 'snake-tail' : 'food'}${cell === 'head' && flashHead ? ' cell-snake-head-flash' : ''}` : ''}`}
                                />
                            ))
                        )}
                    </div>

                    {/* Idle / Game over overlay */}
                    {state.phase !== 'running' && (
                        <div className={`game-message${state.phase === 'dead' ? ' game-over' : ''}`}>
                            {state.phase === 'dead' ? (
                                <>
                                    <p>Game over</p>
                                    {isNewBest && <span className="new-best-badge">New best!</span>}
                                    <span className="sub-text">Score: {state.score}</span>
                                    <div className="lower">
                                        <button className="retry-button" onClick={handleReset}>Try again</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p>snake</p>
                                    <span className="sub-text">Press Space or swipe to start</span>
                                    <div className="lower">
                                        <button className="retry-button" onClick={() => dispatch({ type: 'START' })}>Start</button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

// ── Custom hooks ───────────────────────────────────────

function useThemeState() {
    const init = getInitialTheme()
    applyTheme(init)
    return useSimpleState(init)
}

function useSpeedState() {
    const init = (localStorage.getItem('snake-speed') as Speed) || 'normal'
    const [val, set] = useSimpleState<Speed>(init)
    const setAndPersist = useCallback((s: Speed) => {
        set(s); localStorage.setItem('snake-speed', s)
    }, [set])
    return [val, setAndPersist] as const
}

function useStatsData() { return useSimpleState<Stats>(loadStats()) }
function useShakeState() { return useSimpleState(false) }
function useScoreDeltaState() { return useSimpleState<number | null>(null) }
function useNewBestState() { return useSimpleState(false) }
function useFlashHeadState() { return useSimpleState(false) }
function useSpeedRecordsState() { return useSimpleState<Record<Speed, number>>({ slow: 0, normal: 0, fast: 0 }) }

function useClosableOverlay() {
    const [visible, setVisible] = useSimpleState(false)
    const [closing, setClosing] = useSimpleState(false)
    const close = useCallback(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setVisible(false)
            return
        }
        setClosing(true)
        setTimeout(() => { setVisible(false); setClosing(false) }, 180)
    }, [setVisible, setClosing])
    const open = useCallback(() => setVisible(true), [setVisible])
    return [visible, open, closing, close] as const
}

function useSimpleState<T>(initial: T) {
    const [val, setVal] = useStateValue(initial)
    return [val, setVal] as const
}

// minimal useState wrapper with stable setter
function useStateValue<T>(initial: T): [T, (v: T) => void] {
    const ref = useRef(initial)
    const [, rerender] = useReducer(x => x + 1, 0)
    const setter = useCallback((v: T) => { ref.current = v; rerender() }, [])
    return [ref.current, setter]
}
