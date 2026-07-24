export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
export type Point = { x: number; y: number }
export type ObstaclePreset = 'none' | 'sparse' | 'dense' | 'maze'
export type PowerUpType = 'ghost' | 'slow' | 'shrink' | 'golden'
export type VisualTheme = 'modern' | 'neon' | 'gameboy' | 'sunset'
export type SnakeSkin = 'classic' | 'rainbow' | 'cyan' | 'fire' | 'gold'

export interface PowerUpItem {
    pos: Point
    type: PowerUpType
    expiresAt: number
}

export interface ActivePowerUp {
    type: PowerUpType
    expiresAt: number
}

export const GRID = 20

export function createInitialSnake(): Point[] {
    const mid = Math.floor(GRID / 2)
    return [
        { x: mid, y: mid },
        { x: mid - 1, y: mid },
        { x: mid - 2, y: mid },
    ]
}

export function wrapPoint(p: Point): Point {
    return {
        x: ((p.x % GRID) + GRID) % GRID,
        y: ((p.y % GRID) + GRID) % GRID,
    }
}

export function moveSnake(snake: Point[], dir: Direction, wrap: boolean): Point[] {
    const head = snake[0]
    let next: Point
    switch (dir) {
        case 'UP': next = { x: head.x, y: head.y - 1 }; break
        case 'DOWN': next = { x: head.x, y: head.y + 1 }; break
        case 'LEFT': next = { x: head.x - 1, y: head.y }; break
        case 'RIGHT': next = { x: head.x + 1, y: head.y }; break
    }
    if (wrap) next = wrapPoint(next)
    return [next, ...snake.slice(0, -1)]
}

export function grow(snake: Point[]): Point[] {
    const tail = snake[snake.length - 1]
    return [...snake, { ...tail }]
}

export function shrinkSnake(snake: Point[]): Point[] {
    if (snake.length <= 3) return snake
    return snake.slice(0, Math.max(3, snake.length - 2))
}

export function isOutOfBounds(head: Point): boolean {
    return head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID
}

export function hasSelfCollision(snake: Point[]): boolean {
    const [head, ...body] = snake
    return body.some(seg => seg.x === head.x && seg.y === head.y)
}

export function isDead(snake: Point[], obstacles: Point[], wrap: boolean, isGhost = false): boolean {
    const head = snake[0]
    if (isGhost) {
        // Even in ghost mode, wrap the head if wall-wrapping is on or keep inside grid
        return false
    }
    if (!wrap && isOutOfBounds(head)) return true
    if (hasSelfCollision(snake)) return true
    if (obstacles.some(o => o.x === head.x && o.y === head.y)) return true
    return false
}

export function placeFood(snake: Point[], obstacles: Point[] = [], exclude: Point[] = []): Point {
    const occupied = new Set([...snake, ...obstacles, ...exclude].map(p => `${p.x},${p.y}`))
    const empty: Point[] = []
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
            if (!occupied.has(`${x},${y}`)) empty.push({ x, y })
        }
    }
    if (empty.length === 0) return { x: 0, y: 0 }
    return empty[Math.floor(Math.random() * empty.length)]
}

export function getRandomPowerUpType(): PowerUpType {
    const types: PowerUpType[] = ['ghost', 'slow', 'shrink', 'golden']
    return types[Math.floor(Math.random() * types.length)]
}

export function oppositeDir(a: Direction, b: Direction): boolean {
    return (a === 'UP' && b === 'DOWN') ||
        (a === 'DOWN' && b === 'UP') ||
        (a === 'LEFT' && b === 'RIGHT') ||
        (a === 'RIGHT' && b === 'LEFT')
}

export const SPEED_MS: Record<string, number> = {
    slow: 220,
    normal: 130,
    fast: 70,
}

// ── Obstacle generators ────────────────────────────────

function safeZone(): Set<string> {
    // Keep centre 5×5 clear for spawn
    const mid = Math.floor(GRID / 2)
    const zone = new Set<string>()
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -3; dx <= 3; dx++)
            zone.add(`${mid + dx},${mid + dy}`)
    return zone
}

export function generateObstacles(preset: ObstaclePreset): Point[] {
    if (preset === 'none') return []
    const safe = safeZone()
    const pts: Point[] = []

    if (preset === 'sparse') {
        while (pts.length < 12) {
            const p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }
            if (!safe.has(`${p.x},${p.y}`) && !pts.some(o => o.x === p.x && o.y === p.y))
                pts.push(p)
        }
    }

    if (preset === 'dense') {
        while (pts.length < 28) {
            const p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }
            if (!safe.has(`${p.x},${p.y}`) && !pts.some(o => o.x === p.x && o.y === p.y))
                pts.push(p)
        }
    }

    if (preset === 'maze') {
        const mid = Math.floor(GRID / 2)
        for (let x = 2; x < GRID - 2; x++) {
            if (Math.abs(x - mid) > 2) pts.push({ x, y: 5 })
        }
        for (let x = 2; x < GRID - 2; x++) {
            if (Math.abs(x - mid) > 2) pts.push({ x, y: GRID - 6 })
        }
        for (let y = 2; y < GRID - 2; y++) {
            if (Math.abs(y - mid) > 2) pts.push({ x: 5, y })
        }
        for (let y = 2; y < GRID - 2; y++) {
            if (Math.abs(y - mid) > 2) pts.push({ x: GRID - 6, y })
        }
        const seen = new Set<string>()
        return pts.filter(p => {
            const k = `${p.x},${p.y}`
            if (seen.has(k) || safe.has(k)) return false
            seen.add(k); return true
        })
    }

    return pts
}
