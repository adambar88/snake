// Particle Burst System for Snake Game
export interface Particle {
    id: string
    x: number
    y: number
    vx: number
    vy: number
    color: string
    size: number
    life: number
    maxLife: number
}

export function createParticleBurst(cellX: number, cellY: number, color = '#22c55e', count = 14): Particle[] {
    const particles: Particle[] = []
    const baseId = Math.random().toString(36).substring(2, 9)

    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
        const speed = 1.5 + Math.random() * 3
        const maxLife = 12 + Math.floor(Math.random() * 12)

        particles.push({
            id: `${baseId}-${i}`,
            x: cellX * 5 + 2.5, // percent coordinates on grid container
            y: cellY * 5 + 2.5,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            color,
            size: 4 + Math.random() * 5,
            life: maxLife,
            maxLife,
        })
    }

    return particles
}

export function updateParticles(particles: Particle[]): Particle[] {
    return particles
        .map(p => ({
            ...p,
            x: p.x + p.vx * 0.35,
            y: p.y + p.vy * 0.35,
            life: p.life - 1,
            size: p.size * 0.94,
        }))
        .filter(p => p.life > 0)
}
