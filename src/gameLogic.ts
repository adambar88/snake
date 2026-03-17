export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
export type Point = { x: number; y: number }

export const GRID = 20

export function createInitialSnake(): Point[] {
    const mid = Math.floor(GRID / 2)
    return [
        { x: mid, y: mid },
        { x: mid - 1, y: mid },
        { x: mid - 2, y: mid },
    ]
}

export function moveSnake(snake: Point[], dir: Direction): Point[] {
    const head = snake[0]
    let next: Point
    switch (dir) {
        case 'UP': next = { x: head.x, y: head.y - 1 }; break
        case 'DOWN': next = { x: head.x, y: head.y + 1 }; break
        case 'LEFT': next = { x: head.x - 1, y: head.y }; break
        case 'RIGHT': next = { x: head.x + 1, y: head.y }; break
    }
    return [next, ...snake.slice(0, -1)]
}

export function grow(snake: Point[]): Point[] {
    const tail = snake[snake.length - 1]
    return [...snake, { ...tail }]
}

export function isOutOfBounds(head: Point): boolean {
    return head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID
}

export function hasSelfCollision(snake: Point[]): boolean {
    const [head, ...body] = snake
    return body.some(seg => seg.x === head.x && seg.y === head.y)
}

export function isDead(snake: Point[]): boolean {
    return isOutOfBounds(snake[0]) || hasSelfCollision(snake)
}

export function placeFood(snake: Point[]): Point {
    const occupied = new Set(snake.map(p => `${p.x},${p.y}`))
    const empty: Point[] = []
    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
            if (!occupied.has(`${x},${y}`)) empty.push({ x, y })
        }
    }
    if (empty.length === 0) return { x: 0, y: 0 }
    return empty[Math.floor(Math.random() * empty.length)]
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
