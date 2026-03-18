import { useEffect, useRef, useCallback, useReducer, useMemo } from 'react'
import './App.css'
import {
    type Direction, type Point, type ObstaclePreset, GRID, SPEED_MS,
    createInitialSnake, moveSnake, grow,
    isDead, placeFood, oppositeDir, generateObstacles,
} from './gameLogic'

// ── Types ──────────────────────────────────────────────

type Speed = 'slow' | 'normal' | 'fast'

interface Stats {
    gamesPlayed: number
    bestScore: number
    totalFood: number
}

interface Settings {
    wrapWalls: boolean
    bonusFood: boolean
    obstacles: ObstaclePreset
    countdown: 0 | 60 | 90
    autoRamp: boolean
    gridLines: boolean
}

const DEFAULT_SETTINGS: Settings = {
    wrapWalls: false,
    bonusFood: false,
    obstacles: 'none',
    countdown: 0,
    autoRamp: false,
    gridLines: false,
}

function loadStats(): Stats {
    try {
        return JSON.parse(localStorage.getItem('snake-stats') || 'null') ?? { gamesPlayed: 0, bestScore: 0, totalFood: 0 }
    } catch { return { gamesPlayed: 0, bestScore: 0, totalFood: 0 } }
}

function saveStats(s: Stats) {
    localStorage.setItem('snake-stats', JSON.stringify(s))
}

function loadSettings(): Settings {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('snake-settings') || 'null') }
    } catch { return { ...DEFAULT_SETTINGS } }
}

function saveSettings(s: Settings) {
    localStorage.setItem('snake-settings', JSON.stringify(s))
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

type Phase = 'idle' | 'running' | 'paused' | 'dead'

interface BonusFood {
    pos: Point
    expiresAt: number
    value: number
}

interface GameState {
    snake: Point[]
    food: Point
    bonusFood: BonusFood | null
    obstacles: Point[]
    dir: Direction
    pendingDir: Direction
    score: number
    timeLeft: number    // seconds; -1 = no countdown
    speedLevel: number  // auto-ramp level; 0 = base speed
    phase: Phase
}

function initState(settings: Settings): GameState {
    const snake = createInitialSnake()
    const obstacles = generateObstacles(settings.obstacles)
    const food = placeFood(snake, obstacles)
    return {
        snake,
        food,
        bonusFood: null,
        obstacles,
        dir: 'RIGHT',
        pendingDir: 'RIGHT',
        score: 0,
        timeLeft: settings.countdown > 0 ? settings.countdown : -1,
        speedLevel: 0,
        phase: 'idle',
    }
}

type Action =
    | { type: 'START' }
    | { type: 'PAUSE' }
    | { type: 'RESUME' }
    | { type: 'TICK'; settings: Settings }
    | { type: 'COUNTDOWN_TICK' }
    | { type: 'SPAWN_BONUS'; pos: Point; expiresAt: number }
    | { type: 'EXPIRE_BONUS' }
    | { type: 'STEER'; dir: Direction }
    | { type: 'RESET'; settings: Settings }

function currentSpeedMs(speed: Speed, speedLevel: number): number {
    const base = SPEED_MS[speed]
    return Math.max(40, Math.round(base * Math.pow(0.9, speedLevel)))
}

function reducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'START':
            return { ...state, phase: 'running' }

        case 'PAUSE':
            return state.phase === 'running' ? { ...state, phase: 'paused' } : state

        case 'RESUME':
            return state.phase === 'paused' ? { ...state, phase: 'running' } : state

        case 'STEER': {
            if (oppositeDir(state.dir, action.dir)) return state
            return { ...state, pendingDir: action.dir }
        }

        case 'TICK': {
            if (state.phase !== 'running') return state
            const { settings } = action
            const newDir = state.pendingDir
            const moved = moveSnake(state.snake, newDir, settings.wrapWalls)
            if (isDead(moved, state.obstacles, settings.wrapWalls)) {
                return { ...state, dir: newDir, snake: moved, phase: 'dead' }
            }
            const ateFood = moved[0].x === state.food.x && moved[0].y === state.food.y
            const ateBonus = state.bonusFood !== null &&
                moved[0].x === state.bonusFood.pos.x && moved[0].y === state.bonusFood.pos.y
            const bonusValue = state.bonusFood?.value ?? 0
            const newSnake = (ateFood || ateBonus) ? grow(moved) : moved
            const newFood = ateFood
                ? placeFood(newSnake, state.obstacles, state.bonusFood ? [state.bonusFood.pos] : [])
                : state.food
            const newBonus = ateBonus ? null : state.bonusFood
            const scoreGain = (ateFood ? 1 : 0) + (ateBonus ? bonusValue : 0)
            const newScore = state.score + scoreGain
            const newSpeedLevel = settings.autoRamp ? Math.floor(newScore / 10) : 0
            return {
                ...state,
                dir: newDir,
                pendingDir: newDir,
                snake: newSnake,
                food: newFood,
                bonusFood: newBonus,
                score: newScore,
                speedLevel: newSpeedLevel,
                phase: 'running',
            }
        }

        case 'COUNTDOWN_TICK': {
            if (state.phase !== 'running' || state.timeLeft <= 0) return state
            const newTime = state.timeLeft - 1
            if (newTime === 0) return { ...state, timeLeft: 0, phase: 'dead' }
            return { ...state, timeLeft: newTime }
        }

        case 'SPAWN_BONUS':
            if (state.bonusFood !== null) return state
            return { ...state, bonusFood: { pos: action.pos, expiresAt: action.expiresAt, value: 3 } }

        case 'EXPIRE_BONUS':
            return { ...state, bonusFood: null }

        case 'RESET':
            return initState(action.settings)

        default:
            return state
    }
}

// ── Board building ─────────────────────────────────────

type CellType = 'empty' | 'head' | 'body' | 'tail' | 'food' | 'bonus' | 'obstacle'

function buildGrid(
    snake: Point[],
    food: Point,
    bonusFood: BonusFood | null,
    obstacles: Point[],
): CellType[][] {
    const grid: CellType[][] = Array.from({ length: GRID }, () => Array(GRID).fill('empty'))
    for (const { x, y } of obstacles) {
        if (x >= 0 && x < GRID && y >= 0 && y < GRID) grid[y][x] = 'obstacle'
    }
    for (let i = snake.length - 1; i >= 0; i--) {
        const { x, y } = snake[i]
        if (x < 0 || x >= GRID || y < 0 || y >= GRID) continue
        if (i === 0) grid[y][x] = 'head'
        else if (i === snake.length - 1) grid[y][x] = 'tail'
        else grid[y][x] = 'body'
    }
    grid[food.y][food.x] = 'food'
    if (bonusFood) grid[bonusFood.pos.y][bonusFood.pos.x] = 'bonus'
    return grid
}

// ── Main component ─────────────────────────────────────

export default function App() {
    const [settings, setSettingsState] = useSettingsState()
    const settingsRef = useRef(settings)
    settingsRef.current = settings

    const [speed, setSpeed] = useSpeedState()
    const speedRef = useRef(speed)
    speedRef.current = speed

    const [state, dispatch] = useReducer(reducer, undefined, () => initState(settings))
    const [theme, setThemeState] = useThemeState()
    const [showHelp, openHelp, isHelpClosing, closeHelp] = useClosableOverlay()
    const [showStats, openStats, isStatsClosing, closeStats] = useClosableOverlay()
    const [showSettings, openSettings, isSettingsClosing, closeSettings] = useClosableOverlay()
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
    const speedRef2 = speedRef  // alias kept for clarity in effects
    const stateRef = useRef(state)
    stateRef.current = state
    // Score delta + flash
    useEffect(() => {
        if (state.score > prevScore.current) {
            setScoreDelta(state.score - prevScore.current)
            setTimeout(() => setScoreDelta(null), 800)
            setFlashHead(true)
            setTimeout(() => setFlashHead(false), 200)
        }
        prevScore.current = state.score
    }, [state.score, setScoreDelta, setFlashHead])

    // Game tick — restarts when speedLevel changes (auto-ramp)
    useEffect(() => {
        if (state.phase === 'running') {
            const ms = currentSpeedMs(speedRef2.current, state.speedLevel)
            tickRef.current = setInterval(
                () => dispatch({ type: 'TICK', settings: settingsRef.current }),
                ms,
            )
            return () => { if (tickRef.current) clearInterval(tickRef.current) }
        }
        if (tickRef.current) clearInterval(tickRef.current)
    }, [state.phase, state.speedLevel])

    // Countdown timer (1 s interval, separate from game tick)
    useEffect(() => {
        if (state.phase !== 'running' || state.timeLeft < 0) return
        const id = setInterval(() => dispatch({ type: 'COUNTDOWN_TICK' }), 1000)
        return () => clearInterval(id)
    }, [state.phase, state.timeLeft])

    // Bonus food spawner — fires every 8 s while running
    useEffect(() => {
        if (state.phase !== 'running' || !settings.bonusFood) return
        const id = setInterval(() => {
            const cur = stateRef.current
            if (cur.bonusFood !== null) return
            const pos = placeFood(cur.snake, cur.obstacles, [cur.food])
            dispatch({ type: 'SPAWN_BONUS', pos, expiresAt: Date.now() + 5000 })
        }, 8000)
        return () => clearInterval(id)
    }, [state.phase, settings.bonusFood])

    // Bonus food expiry watcher
    useEffect(() => {
        if (!state.bonusFood) return
        const remaining = state.bonusFood.expiresAt - Date.now()
        if (remaining <= 0) { dispatch({ type: 'EXPIRE_BONUS' }); return }
        const id = setTimeout(() => dispatch({ type: 'EXPIRE_BONUS' }), remaining)
        return () => clearTimeout(id)
    }, [state.bonusFood])

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
            const speedKey = `snake-best-${speedRef2.current}`
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
            // Pause / resume
            if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
                if (phase === 'running') { e.preventDefault(); dispatch({ type: 'PAUSE' }) }
                else if (phase === 'paused') { e.preventDefault(); dispatch({ type: 'RESUME' }) }
                return
            }
            if (dirMap[e.key]) {
                e.preventDefault()
                if (phase === 'idle' || phase === 'dead') {
                    dispatch({ type: 'RESET', settings: settingsRef.current })
                    setTimeout(() => dispatch({ type: 'START' }), 10)
                } else if (phase === 'paused') {
                    dispatch({ type: 'RESUME' })
                } else {
                    dispatch({ type: 'STEER', dir: dirMap[e.key] })
                }
            }
            if (e.key === ' ') {
                e.preventDefault()
                if (phase === 'idle') dispatch({ type: 'START' })
                else if (phase === 'paused') dispatch({ type: 'RESUME' })
                else if (phase === 'dead') {
                    dispatch({ type: 'RESET', settings: settingsRef.current })
                    setTimeout(() => dispatch({ type: 'START' }), 10)
                }
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    // Touch swipe + double-tap to pause — stable listener via phaseRef, registered once
    useEffect(() => {
        let sx = 0, sy = 0
        let lastTap = 0
        const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
        const onEnd = (e: TouchEvent) => {
            const dx = e.changedTouches[0].clientX - sx
            const dy = e.changedTouches[0].clientY - sy
            const phase = phaseRef.current
            // Double-tap: two taps within 300ms with < 30px movement
            if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
                const now = Date.now()
                if (now - lastTap < 300) {
                    if (phase === 'running') dispatch({ type: 'PAUSE' })
                    else if (phase === 'paused') dispatch({ type: 'RESUME' })
                    lastTap = 0
                } else {
                    lastTap = now
                }
                return
            }
            let dir: Direction
            if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'RIGHT' : 'LEFT'
            else dir = dy > 0 ? 'DOWN' : 'UP'
            if (phase === 'idle' || phase === 'dead') {
                dispatch({ type: 'RESET', settings: settingsRef.current })
                setTimeout(() => { dispatch({ type: 'START' }); dispatch({ type: 'STEER', dir }) }, 10)
            } else if (phase === 'paused') {
                dispatch({ type: 'RESUME' })
            } else {
                dispatch({ type: 'STEER', dir })
            }
        }
        window.addEventListener('touchstart', onStart, { passive: true })
        window.addEventListener('touchend', onEnd, { passive: true })
        return () => { window.removeEventListener('touchstart', onStart); window.removeEventListener('touchend', onEnd) }
    }, [])

    const handleReset = useCallback(() => {
        dispatch({ type: 'RESET', settings: settingsRef.current })
        setTimeout(() => dispatch({ type: 'START' }), 10)
    }, [])

    const handleSettingChange = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        const next = { ...settingsRef.current, [key]: value }
        setSettingsState(next)
        saveSettings(next)
    }, [setSettingsState])

    const grid = useMemo(
        () => buildGrid(state.snake, state.food, state.bonusFood, state.obstacles),
        [state.snake, state.food, state.bonusFood, state.obstacles],
    )
    const currentSpeedBest = parseInt(localStorage.getItem(`snake-best-${speed}`) || '0', 10)
    const isSpeedRecord = state.phase === 'running' && state.score > currentSpeedBest

    const activeSettingsCount = [
        settings.wrapWalls,
        settings.bonusFood,
        settings.obstacles !== 'none',
        settings.countdown > 0,
        settings.autoRamp,
        settings.gridLines,
    ].filter(Boolean).length

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
                                <li><strong>P</strong> or <strong>Esc</strong> to pause / resume</li>
                                <li>Swipe on mobile — double-tap to pause</li>
                            </ul>
                        </div>
                        <div className="help-section">
                            <h3>Speed</h3>
                            <p>Choose Slow, Normal, or Fast before or during a game. Higher speed = more challenge.</p>
                        </div>
                        <div className="help-section">
                            <h3>Extras (Settings)</h3>
                            <p>Use the Settings panel to enable wrap walls, bonus food, obstacles, countdown, auto speed-ramp, and grid lines.</p>
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

            {/* Settings overlay */}
            {showSettings && (
                <div className={`help-overlay${isSettingsClosing ? ' overlay-exit' : ''}`} onClick={closeSettings}>
                    <div className="help-panel settings-panel" onClick={e => e.stopPropagation()}>
                        <button className="help-close" onClick={closeSettings} aria-label="Close settings">×</button>
                        <p className="help-title">Settings</p>
                        <p className="settings-note">Changes apply on the next new game.</p>
                        <div className="settings-group">
                            <div className="settings-row">
                                <div className="settings-row-text">
                                    <span className="settings-label">Wrap walls</span>
                                    <span className="settings-desc">Exit one edge, enter the opposite</span>
                                </div>
                                <button className={`toggle-btn${settings.wrapWalls ? ' toggle-on' : ''}`}
                                    onClick={() => handleSettingChange('wrapWalls', !settings.wrapWalls)}
                                    aria-pressed={settings.wrapWalls}>
                                    {settings.wrapWalls ? 'On' : 'Off'}
                                </button>
                            </div>
                            <div className="settings-row">
                                <div className="settings-row-text">
                                    <span className="settings-label">Bonus food</span>
                                    <span className="settings-desc">3-pt item appears every ~8 s, vanishes in 5 s</span>
                                </div>
                                <button className={`toggle-btn${settings.bonusFood ? ' toggle-on' : ''}`}
                                    onClick={() => handleSettingChange('bonusFood', !settings.bonusFood)}
                                    aria-pressed={settings.bonusFood}>
                                    {settings.bonusFood ? 'On' : 'Off'}
                                </button>
                            </div>
                            <div className="settings-row settings-row-wide">
                                <div className="settings-row-text">
                                    <span className="settings-label">Obstacles</span>
                                    <span className="settings-desc">Static wall blocks placed on the board</span>
                                </div>
                                <div className="segment-ctrl">
                                    {(['none', 'sparse', 'dense', 'maze'] as ObstaclePreset[]).map(p => (
                                        <button key={p}
                                            className={`segment-btn${settings.obstacles === p ? ' segment-active' : ''}`}
                                            onClick={() => handleSettingChange('obstacles', p)}
                                            aria-pressed={settings.obstacles === p}>
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="settings-row settings-row-wide">
                                <div className="settings-row-text">
                                    <span className="settings-label">Countdown</span>
                                    <span className="settings-desc">Time limit — score as many pts as possible</span>
                                </div>
                                <div className="segment-ctrl">
                                    {([0, 60, 90] as const).map(v => (
                                        <button key={v}
                                            className={`segment-btn${settings.countdown === v ? ' segment-active' : ''}`}
                                            onClick={() => handleSettingChange('countdown', v)}
                                            aria-pressed={settings.countdown === v}>
                                            {v === 0 ? 'Off' : `${v}s`}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="settings-row">
                                <div className="settings-row-text">
                                    <span className="settings-label">Auto speed-ramp</span>
                                    <span className="settings-desc">Snake speeds up every 10 points</span>
                                </div>
                                <button className={`toggle-btn${settings.autoRamp ? ' toggle-on' : ''}`}
                                    onClick={() => handleSettingChange('autoRamp', !settings.autoRamp)}
                                    aria-pressed={settings.autoRamp}>
                                    {settings.autoRamp ? 'On' : 'Off'}
                                </button>
                            </div>
                            <div className="settings-row">
                                <div className="settings-row-text">
                                    <span className="settings-label">Grid lines</span>
                                    <span className="settings-desc">Show cell grid on the board</span>
                                </div>
                                <button className={`toggle-btn${settings.gridLines ? ' toggle-on' : ''}`}
                                    onClick={() => handleSettingChange('gridLines', !settings.gridLines)}
                                    aria-pressed={settings.gridLines}>
                                    {settings.gridLines ? 'On' : 'Off'}
                                </button>
                            </div>
                        </div>
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
                        {state.timeLeft >= 0 && (
                            <div className={`score-container${state.timeLeft <= 10 ? ' countdown-urgent' : ''}`}>
                                <div className="score-label">Time</div>
                                <div className="score-value">{state.timeLeft}</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sub-header */}
                <div className="game-intro">
                    <div className="intro-buttons">
                        <button className="restart-button" onClick={handleReset}>Restart</button>
                        <button className="stats-button" onClick={openStats}>Stats</button>
                        <button
                            className={`settings-button${activeSettingsCount > 0 ? ' settings-active' : ''}`}
                            onClick={openSettings}
                            aria-label={`Settings${activeSettingsCount > 0 ? ` (${activeSettingsCount} active)` : ''}`}
                        >
                            SETTINGS{activeSettingsCount > 0 && <span className="settings-badge">{activeSettingsCount}</span>}
                        </button>
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
                                {s}{settings.autoRamp && state.phase === 'running' && speed === s && state.speedLevel > 0
                                    ? <span className="ramp-indicator"> +{state.speedLevel}</span>
                                    : null}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Board */}
                <div
                    className={`game-container${shake ? ' game-over-shake' : ''}${settings.gridLines ? ' grid-lines' : ''}`}
                    role="application"
                    aria-label="Snake game board"
                >
                    <div className="grid-canvas">
                        {grid.map((row, y) =>
                            row.map((cell, x) => {
                                let cls = 'grid-cell'
                                if (cell === 'head') cls += ' cell-snake-head' + (flashHead ? ' cell-snake-head-flash' : '')
                                else if (cell === 'body') cls += ' cell-snake-body'
                                else if (cell === 'tail') cls += ' cell-snake-tail'
                                else if (cell === 'food') cls += ' cell-food'
                                else if (cell === 'bonus') cls += ' cell-bonus'
                                else if (cell === 'obstacle') cls += ' cell-obstacle'
                                return <div key={`${x}-${y}`} className={cls} />
                            })
                        )}
                    </div>

                    {/* Pause overlay */}
                    {state.phase === 'paused' && (
                        <div className="game-message">
                            <p>Paused</p>
                            <span className="sub-text">P · Esc · Space to resume</span>
                            <div className="lower">
                                <button className="retry-button" onClick={() => dispatch({ type: 'RESUME' })}>Resume</button>
                            </div>
                        </div>
                    )}

                    {/* Idle / Game over overlay */}
                    {(state.phase === 'idle' || state.phase === 'dead') && (
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

function useSettingsState() {
    return useSimpleState<Settings>(loadSettings())
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
