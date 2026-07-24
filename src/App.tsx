import { useEffect, useRef, useCallback, useReducer, useMemo } from 'react'
import './App.css'
import {
    type Direction, type Point, type ObstaclePreset, type PowerUpType, type VisualTheme, type SnakeSkin,
    type PowerUpItem, type ActivePowerUp, GRID, SPEED_MS,
    createInitialSnake, moveSnake, grow, shrinkSnake,
    isDead, placeFood, oppositeDir, generateObstacles, getRandomPowerUpType,
} from './gameLogic'
import {
    playEatSound, playBonusSound, playPowerUpSound, playDeathSound, playHighScoreSound, triggerHaptic,
} from './sound'
import { createParticleBurst, updateParticles, type Particle } from './particles'

// ── Types ──────────────────────────────────────────────

type Speed = 'slow' | 'normal' | 'fast'
export type ControlMode = 'touch' | 'buttons' | 'both'

interface Stats {
    gamesPlayed: number
    bestScore: number
    totalFood: number
}

interface Settings {
    wrapWalls: boolean
    bonusFood: boolean
    powerUpsEnabled: boolean
    soundEnabled: boolean
    theme: VisualTheme
    skin: SnakeSkin
    obstacles: ObstaclePreset
    controls: ControlMode
    countdown: 0 | 60 | 90
    autoRamp: boolean
    gridLines: boolean
}

const DEFAULT_SETTINGS: Settings = {
    wrapWalls: false,
    bonusFood: true,
    powerUpsEnabled: true,
    soundEnabled: true,
    theme: 'modern',
    skin: 'classic',
    obstacles: 'none',
    controls: 'both',
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

function applyTheme(theme: VisualTheme) {
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
    powerUpItem: PowerUpItem | null
    activePowerUp: ActivePowerUp | null
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
        powerUpItem: null,
        activePowerUp: null,
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
    | { type: 'SPAWN_POWERUP'; pos: Point; powerType: PowerUpType; expiresAt: number }
    | { type: 'EXPIRE_POWERUP_ITEM' }
    | { type: 'EXPIRE_ACTIVE_POWERUP' }
    | { type: 'STEER'; dir: Direction }
    | { type: 'RESET'; settings: Settings }

function currentSpeedMs(speed: Speed, speedLevel: number, activePowerUp: ActivePowerUp | null): number {
    const base = SPEED_MS[speed]
    let ms = Math.max(40, Math.round(base * Math.pow(0.9, speedLevel)))
    if (activePowerUp?.type === 'slow') {
        ms = Math.round(ms * 1.5)
    }
    return ms
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
            const isGhost = state.activePowerUp?.type === 'ghost'

            if (isDead(moved, state.obstacles, settings.wrapWalls, isGhost)) {
                return { ...state, dir: newDir, snake: moved, phase: 'dead' }
            }

            const ateFood = moved[0].x === state.food.x && moved[0].y === state.food.y
            const ateBonus = state.bonusFood !== null &&
                moved[0].x === state.bonusFood.pos.x && moved[0].y === state.bonusFood.pos.y
            const atePowerUp = state.powerUpItem !== null &&
                moved[0].x === state.powerUpItem.pos.x && moved[0].y === state.powerUpItem.pos.y

            let activePowerUp = state.activePowerUp
            let newSnake = moved

            if (atePowerUp && state.powerUpItem) {
                const pType = state.powerUpItem.type
                activePowerUp = { type: pType, expiresAt: Date.now() + 6000 }
                if (pType === 'shrink') {
                    newSnake = shrinkSnake(moved)
                }
            }

            const bonusValue = state.bonusFood?.value ?? 0
            const extraGoldenPoints = (atePowerUp && state.powerUpItem?.type === 'golden') ? 5 : 0

            if (ateFood || ateBonus) {
                newSnake = grow(newSnake)
            }

            const newFood = ateFood
                ? placeFood(newSnake, state.obstacles, [
                    ...(state.bonusFood ? [state.bonusFood.pos] : []),
                    ...(state.powerUpItem ? [state.powerUpItem.pos] : []),
                ])
                : state.food

            const newBonus = ateBonus ? null : state.bonusFood
            const newPowerUpItem = atePowerUp ? null : state.powerUpItem

            const scoreGain = (ateFood ? 1 : 0) + (ateBonus ? bonusValue : 0) + extraGoldenPoints
            const newScore = state.score + scoreGain
            const newSpeedLevel = settings.autoRamp ? Math.floor(newScore / 10) : 0

            return {
                ...state,
                dir: newDir,
                pendingDir: newDir,
                snake: newSnake,
                food: newFood,
                bonusFood: newBonus,
                powerUpItem: newPowerUpItem,
                activePowerUp,
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

        case 'SPAWN_POWERUP':
            if (state.powerUpItem !== null) return state
            return {
                ...state,
                powerUpItem: { pos: action.pos, type: action.powerType, expiresAt: action.expiresAt },
            }

        case 'EXPIRE_POWERUP_ITEM':
            return { ...state, powerUpItem: null }

        case 'EXPIRE_ACTIVE_POWERUP':
            return { ...state, activePowerUp: null }

        case 'RESET':
            return initState(action.settings)

        default:
            return state
    }
}

// ── Board building ─────────────────────────────────────

type CellType =
    | 'empty'
    | 'head'
    | 'body'
    | 'tail'
    | 'food'
    | 'bonus'
    | 'obstacle'
    | 'powerup-ghost'
    | 'powerup-slow'
    | 'powerup-shrink'
    | 'powerup-golden'

function buildGrid(
    snake: Point[],
    food: Point,
    bonusFood: BonusFood | null,
    powerUpItem: PowerUpItem | null,
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
    if (powerUpItem) {
        grid[powerUpItem.pos.y][powerUpItem.pos.x] = `powerup-${powerUpItem.type}` as CellType
    }
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
    const [showHelp, openHelp, isHelpClosing, closeHelp] = useClosableOverlay()
    const [showStats, openStats, isStatsClosing, closeStats] = useClosableOverlay()
    const [showSettings, openSettings, isSettingsClosing, closeSettings] = useClosableOverlay()
    const [stats, setStats] = useStatsData()
    const [shake, setShake] = useShakeState()
    const [scoreDelta, setScoreDelta] = useScoreDeltaState()
    const [isNewBest, setIsNewBest] = useNewBestState()
    const [flashHead, setFlashHead] = useFlashHeadState()
    const [speedRecords, setSpeedRecords] = useSpeedRecordsState()
    const [particles, setParticles] = useParticlesState()
    const [achievementToast, setAchievementToast] = useAchievementToastState()
    const [deferredPrompt, setDeferredPrompt] = useInstallPromptState()



    useEffect(() => {
        const handleBeforeInstall = (e: Event) => {
            e.preventDefault()
            setDeferredPrompt(e)
        }
        window.addEventListener('beforeinstallprompt', handleBeforeInstall)
        return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
    }, [setDeferredPrompt])

    const handleInstallClick = useCallback(async () => {
        if (!deferredPrompt) return
        deferredPrompt.prompt()
        const choice = await (deferredPrompt as any).userChoice
        if (choice?.outcome === 'accepted') {
            setDeferredPrompt(null)
        }
    }, [deferredPrompt, setDeferredPrompt])


    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const animRef = useRef<number | null>(null)
    const prevScore = useRef(state.score)
    const phaseRef = useRef(state.phase)
    phaseRef.current = state.phase
    const stateRef = useRef(state)
    stateRef.current = state
    const overlaysOpenRef = useRef(false)
    overlaysOpenRef.current = showSettings || showHelp || showStats


    // Apply active theme
    useEffect(() => {
        applyTheme(settings.theme)
    }, [settings.theme])

    // Particle Animation Loop
    useEffect(() => {
        if (particles.length === 0) return
        animRef.current = requestAnimationFrame(() => {
            setParticles(prev => updateParticles(prev))
        })
        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current)
        }
    }, [particles, setParticles])

    // Score delta + Audio triggers + Particle explosions
    useEffect(() => {
        if (state.score > prevScore.current) {
            const gain = state.score - prevScore.current
            setScoreDelta(gain)
            setTimeout(() => setScoreDelta(null), 800)
            setFlashHead(true)
            setTimeout(() => setFlashHead(false), 200)

            // Audio & Particles
            if (gain >= 3) {
                playBonusSound(settingsRef.current.soundEnabled)
                setParticles(prev => [...prev, ...createParticleBurst(state.snake[0].x, state.snake[0].y, '#eab308', 20)])
            } else {
                playEatSound(settingsRef.current.soundEnabled)
                setParticles(prev => [...prev, ...createParticleBurst(state.snake[0].x, state.snake[0].y, '#22c55e', 12)])
            }
        }
        prevScore.current = state.score
    }, [state.score, state.snake, setScoreDelta, setFlashHead, setParticles])

    // Active powerup expiry watcher
    useEffect(() => {
        if (!state.activePowerUp) return
        const remaining = state.activePowerUp.expiresAt - Date.now()
        if (remaining <= 0) { dispatch({ type: 'EXPIRE_ACTIVE_POWERUP' }); return }
        const id = setTimeout(() => dispatch({ type: 'EXPIRE_ACTIVE_POWERUP' }), remaining)
        return () => clearTimeout(id)
    }, [state.activePowerUp])

    // PowerUp spawner — fires every 12 s while running
    useEffect(() => {
        if (state.phase !== 'running' || !settings.powerUpsEnabled) return
        const id = setInterval(() => {
            const cur = stateRef.current
            if (cur.powerUpItem !== null) return
            const pType = getRandomPowerUpType()
            const pos = placeFood(cur.snake, cur.obstacles, [cur.food, ...(cur.bonusFood ? [cur.bonusFood.pos] : [])])
            dispatch({ type: 'SPAWN_POWERUP', pos, powerType: pType, expiresAt: Date.now() + 7000 })
            playPowerUpSound(settingsRef.current.soundEnabled)
        }, 12000)
        return () => clearInterval(id)
    }, [state.phase, settings.powerUpsEnabled])

    // PowerUp expiry watcher
    useEffect(() => {
        if (!state.powerUpItem) return
        const remaining = state.powerUpItem.expiresAt - Date.now()
        if (remaining <= 0) { dispatch({ type: 'EXPIRE_POWERUP_ITEM' }); return }
        const id = setTimeout(() => dispatch({ type: 'EXPIRE_POWERUP_ITEM' }), remaining)
        return () => clearTimeout(id)
    }, [state.powerUpItem])

    // Auto-pause whenever any overlay modal is opened
    useEffect(() => {
        if ((showSettings || showHelp || showStats) && phaseRef.current === 'running') {
            dispatch({ type: 'PAUSE' })
        }
    }, [showSettings, showHelp, showStats])

    // Game tick
    useEffect(() => {
        if (state.phase === 'running' && !showSettings && !showHelp && !showStats) {
            const ms = currentSpeedMs(speedRef.current, state.speedLevel, state.activePowerUp)
            tickRef.current = setInterval(
                () => dispatch({ type: 'TICK', settings: settingsRef.current }),
                ms,
            )
            return () => { if (tickRef.current) clearInterval(tickRef.current) }
        }
        if (tickRef.current) {
            clearInterval(tickRef.current)
            tickRef.current = null
        }
    }, [state.phase, state.speedLevel, state.activePowerUp, showSettings, showHelp, showStats])


    // Countdown timer
    useEffect(() => {
        if (state.phase !== 'running' || state.timeLeft < 0) return
        const id = setInterval(() => dispatch({ type: 'COUNTDOWN_TICK' }), 1000)
        return () => clearInterval(id)
    }, [state.phase, state.timeLeft])

    // Bonus food spawner
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

    // Save stats on death
    useEffect(() => {
        if (state.phase === 'dead') {
            playDeathSound(settingsRef.current.soundEnabled)
            setShake(true)
            setTimeout(() => setShake(false), 500)
            const current = loadStats()
            const isBest = state.score > current.bestScore
            setIsNewBest(isBest)
            if (isBest) playHighScoreSound(settingsRef.current.soundEnabled)

            const next: Stats = {
                gamesPlayed: current.gamesPlayed + 1,
                bestScore: Math.max(current.bestScore, state.score),
                totalFood: current.totalFood + state.score,
            }
            setStats(next)
            saveStats(next)

            const speedKey = `snake-best-${speedRef.current}`
            const prevBest = parseInt(localStorage.getItem(speedKey) || '0', 10)
            if (state.score > prevBest) localStorage.setItem(speedKey, String(state.score))

            // Check Achievements
            if (state.score >= 50 && !localStorage.getItem('achievement-50pts')) {
                localStorage.setItem('achievement-50pts', 'true')
                setAchievementToast({ title: 'Achievement Unlocked', desc: 'Score Master: 50+ Points!' })
                setTimeout(() => setAchievementToast(null), 4000)
            }
        }
    }, [state.phase, state.score, setStats, setIsNewBest, setAchievementToast])

    useEffect(() => {
        if (state.phase === 'running') setIsNewBest(false)
    }, [state.phase, setIsNewBest])

    useEffect(() => {
        if (showStats) setSpeedRecords({
            slow: parseInt(localStorage.getItem('snake-best-slow') || '0', 10),
            normal: parseInt(localStorage.getItem('snake-best-normal') || '0', 10),
            fast: parseInt(localStorage.getItem('snake-best-fast') || '0', 10),
        })
    }, [showStats, setSpeedRecords])

    // Keyboard controls
    useEffect(() => {
        const dirMap: Record<string, Direction> = {
            ArrowUp: 'UP', w: 'UP', W: 'UP',
            ArrowDown: 'DOWN', s: 'DOWN', S: 'DOWN',
            ArrowLeft: 'LEFT', a: 'LEFT', A: 'LEFT',
            ArrowRight: 'RIGHT', d: 'RIGHT', D: 'RIGHT',
        }
        const onKey = (e: KeyboardEvent) => {
            if (overlaysOpenRef.current) return
            const phase = phaseRef.current
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

    // Touch swipe controls
    useEffect(() => {
        let sx = 0, sy = 0
        const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
        const onEnd = (e: TouchEvent) => {
            if (overlaysOpenRef.current) return
            if (settingsRef.current.controls === 'buttons') return
            const dx = e.changedTouches[0].clientX - sx
            const dy = e.changedTouches[0].clientY - sy
            if (Math.abs(dx) < 30 && Math.abs(dy) < 30) return
            let dir: Direction
            if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'RIGHT' : 'LEFT'
            else dir = dy > 0 ? 'DOWN' : 'UP'
            triggerHaptic(14)
            const phase = phaseRef.current
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

    const handleOpenSettings = useCallback(() => {
        if (phaseRef.current === 'running') {
            dispatch({ type: 'PAUSE' })
        }
        openSettings()
    }, [openSettings])

    const handleSteer = useCallback((dir: Direction) => {
        if (overlaysOpenRef.current) return
        triggerHaptic(14)
        const phase = phaseRef.current
        if (phase === 'idle' || phase === 'dead') {
            dispatch({ type: 'RESET', settings: settingsRef.current })
            setTimeout(() => {
                dispatch({ type: 'START' })
                dispatch({ type: 'STEER', dir })
            }, 10)
        } else if (phase === 'paused') {
            dispatch({ type: 'RESUME' })
            dispatch({ type: 'STEER', dir })
        } else {
            dispatch({ type: 'STEER', dir })
        }
    }, [])



    const handleSettingChange = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        const next = { ...settingsRef.current, [key]: value }
        setSettingsState(next)
        saveSettings(next)
    }, [setSettingsState])

    const grid = useMemo(
        () => buildGrid(state.snake, state.food, state.bonusFood, state.powerUpItem, state.obstacles),
        [state.snake, state.food, state.bonusFood, state.powerUpItem, state.obstacles],
    )

    const currentSpeedBest = parseInt(localStorage.getItem(`snake-best-${speed}`) || '0', 10)
    const isSpeedRecord = state.phase === 'running' && state.score > currentSpeedBest

    const activeSettingsCount = [
        settings.wrapWalls,
        settings.bonusFood,
        settings.powerUpsEnabled,
        settings.obstacles !== 'none',
        settings.countdown > 0,
        settings.autoRamp,
        settings.gridLines,
    ].filter(Boolean).length

    return (
        <>
            {/* Header controls & Audio toggle */}
            <div className="header-controls" style={{ position: 'absolute', top: 16, right: 16 }}>
                <button
                    className="sound-toggle-btn"
                    aria-label={settings.soundEnabled ? 'Mute audio' : 'Enable audio'}
                    onClick={() => handleSettingChange('soundEnabled', !settings.soundEnabled)}
                >
                    {settings.soundEnabled ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="1" y1="1" x2="23" y2="23" />
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        </svg>
                    )}
                </button>
            </div>

            {/* Achievement Toast */}
            {achievementToast && (
                <div className="achievement-toast">
                    <span className="toast-icon">🏆</span>
                    <div>
                        <div className="toast-title">{achievementToast.title}</div>
                        <div className="toast-desc">{achievementToast.desc}</div>
                    </div>
                </div>
            )}

            {/* Help overlay */}
            {showHelp && (
                <div className={`help-overlay${isHelpClosing ? ' overlay-exit' : ''}`} onClick={closeHelp}>
                    <div className="help-panel" onClick={e => e.stopPropagation()}>
                        <button className="help-close" onClick={closeHelp} aria-label="Close help">×</button>
                        <p className="help-title">How to play</p>
                        <div className="help-section">
                            <h3>Basics</h3>
                            <p>Guide the snake to eat food. Each piece eaten grows the snake and scores a point. Collect Power-Ups for special abilities!</p>
                        </div>
                        <div className="help-section">
                            <h3>Power-Ups</h3>
                            <ul>
                                <li>👻 <strong>Ghost</strong>: Pass through walls & obstacles</li>
                                <li>⏱️ <strong>Slow-Mo</strong>: Slows down speed by 40%</li>
                                <li>✂️ <strong>Shrink</strong>: Reduces snake length by 2</li>
                                <li>🌟 <strong>Golden Apple</strong>: Scores +5 Bonus Points</li>
                            </ul>
                        </div>
                        <div className="help-section">
                            <h3>Controls</h3>
                            <ul>
                                <li>Arrow keys or WASD to steer</li>
                                <li>On-screen D-pad under board</li>
                                <li>Space bar to start / restart</li>
                                <li><strong>P</strong> or <strong>Esc</strong> to pause / resume</li>
                                <li>Swipe on mobile</li>
                            </ul>
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
                            <div className="settings-row settings-row-wide">
                                <div className="settings-row-text">
                                    <span className="settings-label">Visual Theme</span>
                                    <span className="settings-desc">Color palette & visual style</span>
                                </div>
                                <div className="segment-ctrl">
                                    {(['modern', 'neon', 'gameboy', 'sunset'] as VisualTheme[]).map(t => (
                                        <button key={t}
                                            className={`segment-btn${settings.theme === t ? ' segment-active' : ''}`}
                                            onClick={() => handleSettingChange('theme', t)}
                                            aria-pressed={settings.theme === t}>
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="settings-row settings-row-wide">
                                <div className="settings-row-text">
                                    <span className="settings-label">Controls</span>
                                    <span className="settings-desc">Touch Swipe, On-Screen D-Pad, or Both</span>
                                </div>
                                <div className="segment-ctrl">
                                    {(['touch', 'buttons', 'both'] as ControlMode[]).map(ctrl => (
                                        <button key={ctrl}
                                            className={`segment-btn${settings.controls === ctrl ? ' segment-active' : ''}`}
                                            onClick={() => handleSettingChange('controls', ctrl)}
                                            aria-pressed={settings.controls === ctrl}>
                                            {ctrl === 'touch' ? 'Touch Only' : ctrl === 'buttons' ? 'D-Pad Only' : 'Both'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="settings-row settings-row-wide">
                                <div className="settings-row-text">
                                    <span className="settings-label">Snake Skin</span>
                                    <span className="settings-desc">Snake body appearance</span>
                                </div>

                                <div className="segment-ctrl">
                                    {(['classic', 'rainbow', 'cyan', 'fire', 'gold'] as SnakeSkin[]).map(sk => (
                                        <button key={sk}
                                            className={`segment-btn${settings.skin === sk ? ' segment-active' : ''}`}
                                            onClick={() => handleSettingChange('skin', sk)}
                                            aria-pressed={settings.skin === sk}>
                                            {sk}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="settings-row">
                                <div className="settings-row-text">
                                    <span className="settings-label">Power-Ups</span>
                                    <span className="settings-desc">Spawn Ghost, Slow-Mo, Shrink & Golden apples</span>
                                </div>
                                <button className={`toggle-btn${settings.powerUpsEnabled ? ' toggle-on' : ''}`}
                                    onClick={() => handleSettingChange('powerUpsEnabled', !settings.powerUpsEnabled)}
                                    aria-pressed={settings.powerUpsEnabled}>
                                    {settings.powerUpsEnabled ? 'On' : 'Off'}
                                </button>
                            </div>
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
                                    <span className="settings-desc">3-pt item appears every ~8 s</span>
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
                                    <span className="settings-desc">Static wall blocks on board</span>
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
                            {deferredPrompt && (
                                <div className="settings-row">
                                    <div className="settings-row-text">
                                        <span className="settings-label">PWA App</span>
                                        <span className="settings-desc">Install Snake app on your device</span>
                                    </div>
                                    <button className="install-pwa-setting-btn" onClick={handleInstallClick}>
                                        Install
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}


            <div className={`container skin-${settings.skin}`}>
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
                            onClick={handleOpenSettings}
                            aria-label={`Settings${activeSettingsCount > 0 ? ` (${activeSettingsCount} active)` : ''}`}
                        >
                            SETTINGS{activeSettingsCount > 0 && <span className="settings-badge">{activeSettingsCount}</span>}
                        </button>
                    </div>



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

                {/* Active Powerup Bar (Placed under slow/normal/fast buttons with reserved height) */}
                <div className="active-powerup-bar">
                    {state.activePowerUp && (
                        <span className={`active-powerup-badge badge-${state.activePowerUp.type}`}>
                            ⚡ {state.activePowerUp.type.toUpperCase()} MODE
                        </span>
                    )}
                </div>


                {/* Board */}
                <div
                    className={`game-container${shake ? ' game-over-shake' : ''}${settings.gridLines ? ' grid-lines' : ''}`}
                    role="application"
                    aria-label="Snake game board"
                    onDoubleClick={() => {
                        if (state.phase === 'running') dispatch({ type: 'PAUSE' })
                        else if (state.phase === 'paused') dispatch({ type: 'RESUME' })
                    }}
                >


                    {/* Particles layer */}
                    <div className="particle-layer">
                        {particles.map(p => (
                            <div
                                key={p.id}
                                className="particle-dot"
                                style={{
                                    left: `${p.x}%`,
                                    top: `${p.y}%`,
                                    width: `${p.size}px`,
                                    height: `${p.size}px`,
                                    backgroundColor: p.color,
                                    opacity: p.life / p.maxLife,
                                }}
                            />
                        ))}
                    </div>

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
                                else if (cell.startsWith('powerup-')) {
                                    cls += ` cell-powerup cell-${cell}`
                                }
                                return <div key={`${x}-${y}`} className={cls} />
                            })
                        )}
                    </div>

                    {/* Pause overlay */}
                    {state.phase === 'paused' && (
                        <div className="game-message">
                            <p>Paused</p>
                            <span className="sub-text">P · Esc · Space · double-click to resume</span>
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

                {/* On-screen Directional Control Keys (D-Pad) */}
                {settings.controls !== 'touch' && (
                    <div className="dpad-container" aria-label="On-screen directional controls">
                        <div className="dpad-row">
                            <button
                                className="dpad-btn dpad-up"
                                aria-label="Steer Up"
                                onPointerDown={(e) => { e.preventDefault(); handleSteer('UP'); }}
                            >
                                ▲
                            </button>
                        </div>
                        <div className="dpad-row">
                            <button
                                className="dpad-btn dpad-left"
                                aria-label="Steer Left"
                                onPointerDown={(e) => { e.preventDefault(); handleSteer('LEFT'); }}
                            >
                                ◄
                            </button>
                            <button
                                className="dpad-btn dpad-down"
                                aria-label="Steer Down"
                                onPointerDown={(e) => { e.preventDefault(); handleSteer('DOWN'); }}
                            >
                                ▼
                            </button>
                            <button
                                className="dpad-btn dpad-right"
                                aria-label="Steer Right"
                                onPointerDown={(e) => { e.preventDefault(); handleSteer('RIGHT'); }}
                            >
                                ►
                            </button>
                        </div>
                    </div>
                )}
            </div>

        </>
    )
}

// ── Custom hooks ───────────────────────────────────────

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
function useParticlesState() { return useSimpleState<Particle[]>([]) }
function useAchievementToastState() { return useSimpleState<{ title: string; desc: string } | null>(null) }
function useInstallPromptState() { return useSimpleState<any>(null) }


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

type SetStateAction<T> = T | ((prev: T) => T)

function useStateValue<T>(initial: T): [T, (v: SetStateAction<T>) => void] {
    const ref = useRef(initial)
    const [, rerender] = useReducer(x => x + 1, 0)
    const setter = useCallback((v: SetStateAction<T>) => {
        ref.current = typeof v === 'function' ? (v as (prev: T) => T)(ref.current) : v
        rerender()
    }, [])
    return [ref.current, setter]
}

